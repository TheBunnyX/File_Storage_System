import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const source = path.resolve(process.env.NEXAFILE_DATA_DIR || 'data');
const argument = process.argv[2];
if (!argument) throw new Error('Usage: npm run backup -- <new-backup-directory>');
const destination = path.resolve(argument);
if (destination === source || destination.startsWith(source + path.sep)) throw new Error('Choose a backup directory outside the live data directory.');
if (existsSync(destination)) throw new Error('The backup directory must not already exist. Existing backups are never overwritten.');
if (!existsSync(path.join(source, 'nexafile.sqlite'))) throw new Error('No workspace database was found. Start NexaFile and create an account first.');
await mkdir(path.join(destination, 'blobs'), { recursive: true, mode: 0o700 });
const live = new DatabaseSync(path.join(source, 'nexafile.sqlite'), { readOnly: true });
try {
  await backup(live, path.join(destination, 'nexafile.sqlite'));
  const snapshot = new DatabaseSync(path.join(destination, 'nexafile.sqlite'), { readOnly: true });
  try {
    const hashes = snapshot.prepare('SELECT DISTINCT hash FROM versions UNION SELECT DISTINCT hash FROM files').all().map(row => row.hash);
    for (const hash of hashes) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid blob identifier in database.'); await copyFile(path.join(source, 'blobs', hash), path.join(destination, 'blobs', hash)); }
    if (existsSync(path.join(source, 'server.key'))) await copyFile(path.join(source, 'server.key'), path.join(destination, 'server.key'));
    await writeFile(path.join(destination, 'backup.json'), JSON.stringify({ version: 1, created: new Date().toISOString(), blobs: hashes.length, complete: true }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Backup complete: ${hashes.length} content blobs saved to ${destination}`);
  } finally { snapshot.close(); }
} finally { live.close(); }
