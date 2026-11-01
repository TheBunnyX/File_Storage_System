import { mysqlEnabled } from './mysql';
import { runServiceBackup, verifyServiceBackup } from './service-backup';
import { s3Prefix } from './blobs';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, copyFile, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { existsSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { all, dataDirectory, db, one, run, transaction, requireValue } from './db';
import { audit } from './security';
import { appSettings } from './settings';
export const backupRoot = path.resolve(/* turbopackIgnore: true */ process.env.NEXAFILE_BACKUP_DIR || `${dataDirectory}-backups`);
export async function operationSettings() {
    const saved = JSON.parse((await one<{
        value: string;
    }>("SELECT value FROM operations WHERE key='backup-settings'"))?.value || '{}');
    return { enabled: saved.enabled ?? process.env.NEXAFILE_BACKUPS !== 'off', intervalMinutes: saved.intervalMinutes ?? Math.max(15, Number(process.env.BACKUP_INTERVAL_MINUTES) || 1440), retain: saved.retain ?? Math.max(1, Number(process.env.BACKUP_RETAIN) || 7) };
}
export async function verifyBackup(directory: string) {
    if(mysqlEnabled()) return verifyServiceBackup(path.basename(directory));
    const snapshot = new DatabaseSync(path.join(directory, 'nexafile.sqlite'), { readOnly: true });
    try {
        requireValue(snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok', 'Backup database integrity check failed.', 500);
        const hashes = snapshot.prepare('SELECT DISTINCT hash FROM versions UNION SELECT DISTINCT hash FROM files').all().map(row => String(row.hash));
        for (const hash of hashes) {
            requireValue(/^[a-f0-9]{64}$/.test(hash), 'Invalid blob identifier in backup.', 500);
            const file = await readFile(path.join(directory, 'blobs', hash));
            requireValue(createHash('sha256').update(file).digest('hex') === hash, 'Backup content verification failed.', 500);
        }
        return { files: Number(snapshot.prepare('SELECT COUNT(*) AS count FROM files').get()!.count), blobs: hashes.length, verified: true };
    }
    finally {
        snapshot.close();
    }
}
async function pruneBackups(retain: number) {
    const entries = (await readdir(backupRoot)).filter(name => /^nexafile-[\dTZ-]+-[a-f0-9]{8}$/.test(name)).sort().reverse();
    const completed: string[] = [];
    for (const name of entries) {
        const target = path.resolve(backupRoot, name);
        const relative = path.relative(backupRoot, target);
        if (relative.startsWith('..') || path.isAbsolute(relative) || (await lstat(target)).isSymbolicLink())
            continue;
        try {
            const manifest = JSON.parse(await readFile(path.join(target, 'backup.json'), 'utf8'));
            if (manifest.kind === 'nexafile-backup-v2' && manifest.verified)
                completed.push(target);
        }
        catch { }
    }
    for (const target of completed.slice(retain)) {
        const relative = path.relative(backupRoot, path.resolve(target));
        requireValue(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Unsafe backup retention path.', 500);
        await rm(target, { recursive: true });
    }
}
let running = false;
export async function runBackup(actorId: number | null = null) {
    if(mysqlEnabled())return runServiceBackup(actorId);
    requireValue(!running, 'A backup is already running.', 409);
    const acquired = (await transaction(async () => {
        const lease = Number((await one<{
            value: string;
        }>("SELECT value FROM operations WHERE key='backup-lease'"))?.value || '0');
        if (lease > Date.now())
            return false;
        (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-lease',?)", String(Date.now() + 3600000)));
        return true;
    }));
    requireValue(acquired, 'Another server process is creating a backup.', 409);
    running = true;
    const time = new Date().toISOString();
    const name = `nexafile-${time.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    const destination = path.join(backupRoot, name);
    (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-status',?)", JSON.stringify({ status: 'running', started: time })));
    try {
        requireValue(backupRoot !== dataDirectory && !backupRoot.startsWith(dataDirectory + path.sep), 'Backups must be outside the live data directory.', 500);
        await mkdir(path.join(destination, 'blobs'), { recursive: true, mode: 0o700 });
        await backup(db(), path.join(destination, 'nexafile.sqlite'));
        const snapshot = new DatabaseSync(path.join(destination, 'nexafile.sqlite'), { readOnly: true });
        try {
            const hashes = snapshot.prepare('SELECT DISTINCT hash FROM versions UNION SELECT DISTINCT hash FROM files').all();
            for (const item of hashes) {
                const hash = String(item.hash);
                requireValue(/^[a-f0-9]{64}$/.test(hash), 'Invalid content identifier.', 500);
                await copyFile(path.join(dataDirectory, 'blobs', hash), path.join(destination, 'blobs', hash));
            }
        }
        finally {
            snapshot.close();
        }
        if (existsSync(path.join(dataDirectory, 'server.key')))
            await copyFile(path.join(dataDirectory, 'server.key'), path.join(destination, 'server.key'));
        const verification = await verifyBackup(destination);
        const manifest = { kind: 'nexafile-backup-v2', created: time, ...verification };
        await writeFile(path.join(destination, 'backup.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
        const result = { ...manifest, status: 'complete', name, completed: new Date().toISOString() };
        (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-status',?)", JSON.stringify(result)));
        (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-last-success',?)", String(Date.now())));
        await pruneBackups((await operationSettings()).retain);
        (await audit(actorId, 'backup.completed', `${name}: ${verification.blobs} verified blobs`));
        return result;
    }
    catch (error) {
        (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-status',?)", JSON.stringify({ status: 'failed', started: time, message: error instanceof Error ? error.message : 'Backup failed.' })));
        (await audit(actorId, 'backup.failed'));
        throw error;
    }
    finally {
        running = false;
        (await run("DELETE FROM operations WHERE key='backup-lease'"));
    }
}
const schedulerState = globalThis as typeof globalThis & {
    nexafileBackupTimer?: ReturnType<typeof setInterval>;
};
export async function purgeExpiredTrash() {
    const days = (await appSettings()).trashRetentionDays;
    if (!days)
        return 0;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return (await transaction(async () => {
        const expired = (await all<{
            id: number;
        }>('SELECT id FROM files WHERE deleted=1 AND modified<?', cutoff));
        for (const { id } of expired) {
            (await run("DELETE FROM shares WHERE kind='file' AND resource_id=?", id));
            (await run('DELETE FROM files WHERE id=?', id));
        }
        if (expired.length)
            (await audit(null, 'trash.purged', String(expired.length)));
        return expired.length;
    }));
}
export async function ensureBackupScheduler() {
    if (process.env.NODE_ENV === 'test' || schedulerState.nexafileBackupTimer)
        return;
    schedulerState.nexafileBackupTimer = setInterval(() => {
        void (async()=>{try{
        const settings = (await operationSettings());
        if (!settings.enabled || running)
            return;
        const last = Number((await one<{
            value: string;
        }>("SELECT value FROM operations WHERE key='backup-last-success'"))?.value || '0');
        if (Date.now() - last > settings.intervalMinutes * 60000)
            void runBackup().catch(() => { });

        }catch{/* Service downtime is retried on the next scheduler tick. */}})();
    }, 60000);
    schedulerState.nexafileBackupTimer.unref();
    const purge = async () => {
        try {
            (await purgeExpiredTrash());
        }
        catch { }
    };
    (await purge());
    setInterval(purge, 3600000).unref();
}
export async function operationsStatus() {
    let disk: {
        free: number;
        total: number;
    } | null = null;
    try {
        const stats = statfsSync(dataDirectory);
        disk = { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
    }
    catch { }
    return { backups: (await operationSettings()), lastBackup: JSON.parse((await one<{
            value: string;
        }>("SELECT value FROM operations WHERE key='backup-status'"))?.value || 'null'), disk, backupDirectory: mysqlEnabled()?`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${s3Prefix()}backups/`:backupRoot };
}
