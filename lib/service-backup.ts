import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { all, one, run, transaction, dataDirectory, requireValue } from './db';
import { TABLES } from './mysql-schema';
import { getObject, putObject, readBlob, s3Client, s3Prefix } from './blobs';
import { audit } from './security';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function base(name: string) { requireValue(/^nexafile-[\dTZ-]+-[a-f0-9]{8}$/.test(name), 'Invalid backup name.'); return s3Prefix() + 'backups/' + name + '/'; }
export async function verifyServiceBackup(name: string) {
  const prefix = base(name), manifest = JSON.parse((await getObject(prefix + 'backup.json')).toString());
  requireValue(manifest.kind === 'nexafile-mysql-s3-v1' && Array.isArray(manifest.hashes), 'Invalid backup manifest.', 500);
  const bytes = await getObject(prefix + 'database.json');
  requireValue(digest(bytes) === manifest.databaseHash, 'Backup database integrity check failed.', 500);
  const snapshot = JSON.parse(bytes.toString());
  requireValue(TABLES.every(table => Array.isArray(snapshot.tables[table])), 'Backup tables are incomplete.', 500);
  for (const hash of manifest.hashes) {
    requireValue(/^[a-f0-9]{64}$/.test(hash), 'Invalid content identifier.', 500);
    requireValue(digest(await getObject(prefix + 'blobs/' + hash)) === hash, 'Backup content verification failed.', 500);
  }
  if (manifest.keyHash) { const key = await getObject(prefix + 'server.key'); requireValue(key.length === 32 && digest(key) === manifest.keyHash, 'Backup encryption key verification failed.', 500); }
  return { verified: true, files: snapshot.tables.files.length, blobs: manifest.hashes.length };
}
let running = false;
async function pruneServiceBackups(retain: number) {
  const root = s3Prefix() + 'backups/';
  const names: string[] = []; let token: string | undefined;
  do {
    const page = await s3Client().send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: root, Delimiter: '/', ContinuationToken: token }));
    for (const item of page.CommonPrefixes || []) { const name = item.Prefix!.slice(root.length).replace(/\/$/, ''); if (/^nexafile-[\dTZ-]+-[a-f0-9]{8}$/.test(name)) names.push(name); }
    token = page.NextContinuationToken;
  } while (token);
  const completed: string[] = [];
  for (const name of names.sort().reverse()) {
    try { const manifest = JSON.parse((await getObject(base(name) + 'backup.json')).toString()); if (manifest.kind === 'nexafile-mysql-s3-v1' && manifest.verified === true) completed.push(name); } catch { /* Incomplete backups are preserved for inspection. */ }
  }
  for (const name of completed.slice(retain)) {
    const prefix = base(name); let continuation: string | undefined;
    do {
      const page = await s3Client().send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix, ContinuationToken: continuation }));
      for (const object of page.Contents || []) { requireValue(object.Key?.startsWith(prefix), 'Unsafe backup retention path.', 500); await s3Client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.Key })); }
      continuation = page.NextContinuationToken;
    } while (continuation);
  }
}
export async function runServiceBackup(actorId: number | null) {
  requireValue(!running, 'A backup is already running.', 409);
  const acquired = await transaction(async () => {
    await run("INSERT OR IGNORE INTO operations(key,value) VALUES('backup-lease','0')");
    const lease = await one<{ value: string }>("SELECT value FROM operations WHERE key='backup-lease' FOR UPDATE");
    if (Number(lease?.value) > Date.now()) return false;
    await run("UPDATE operations SET value=? WHERE key='backup-lease'", String(Date.now() + 3600000)); return true;
  });
  requireValue(acquired, 'Another server process is creating a backup.', 409); running = true;
  const created = new Date().toISOString(), name = 'nexafile-' + created.replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex'), prefix = base(name);
  try {
    await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-status',?)", JSON.stringify({ status: 'running', started: created }));
    const snapshot = await transaction(async () => { const tables: Record<string, unknown[]> = {}; for (const table of TABLES) tables[table] = await all('SELECT * FROM `' + table + '`'); return { kind: 'nexafile-mysql-v1', created, tables }; });
    const bytes = Buffer.from(JSON.stringify(snapshot)); await putObject(prefix + 'database.json', bytes, 'application/json');
    const hashes = [...new Set((snapshot.tables.files.concat(snapshot.tables.versions) as { hash: string }[]).map(row => row.hash))];
    for (const hash of hashes) await putObject(prefix + 'blobs/' + hash, await readBlob(hash));
    let keyHash: string | undefined;
    try { const key = await readFile(path.join(dataDirectory, 'server.key')); keyHash = digest(key); await putObject(prefix + 'server.key', key); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const manifest = { kind: 'nexafile-mysql-s3-v1', created, databaseHash: digest(bytes), hashes, keyHash };
    await putObject(prefix + 'backup.json', Buffer.from(JSON.stringify(manifest)), 'application/json');
    const verified = await verifyServiceBackup(name);
    await putObject(prefix + 'backup.json', Buffer.from(JSON.stringify({ ...manifest, verified: true })), 'application/json');
    const result = { ...verified, kind: manifest.kind, created, name, completed: new Date().toISOString(), status: 'complete' };
    await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-status',?)", JSON.stringify(result));
    await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-last-success',?)", String(Date.now()));
    const settings = JSON.parse((await one<{value:string}>("SELECT value FROM operations WHERE key='backup-settings'"))?.value || '{}');
    await pruneServiceBackups(Math.max(1, Number(settings.retain || process.env.BACKUP_RETAIN) || 7));
    await audit(actorId, 'backup.completed', name); return result;
  } catch (error) {
    await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-status',?)", JSON.stringify({ status: 'failed', started: created, message: 'Remote backup failed. Check service connectivity.' }));
    throw error;
  } finally { running = false; await run("DELETE FROM operations WHERE key='backup-lease'"); }
}
