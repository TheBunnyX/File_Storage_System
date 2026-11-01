import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
// Needs a running clamd (e.g. the nexafile-clamav container). Uses isolated SQLite/local storage on port 3114.
const base = 'http://127.0.0.1:3114', storage = await mkdtemp(path.join(os.tmpdir(), 'nexafile-antivirus-'));
const clamHost = process.env.CLAMAV_HOST || '127.0.0.1', clamPort = process.env.CLAMAV_PORT || '3310';
let server, output = '', checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function start(host = clamHost, port = clamPort, required = 'false') { server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3114', '-H', '127.0.0.1'], { env: { ...process.env, DATABASE_BACKEND: 'sqlite', BLOB_BACKEND: 'local', REDIS_ENABLED: 'false', NEXAFILE_DEMO: 'false', NEXAFILE_DATA_DIR: storage, NEXAFILE_BACKUPS: 'off', NEXAFILE_ADMIN_EMAILS: 'owner@antivirus.test', APP_URL: base, CLAMAV_HOST: host, CLAMAV_PORT: port, CLAMAV_SOCKET: '', ANTIVIRUS_REQUIRED: required, DISABLE_REGISTRATION: 'false' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); server.stdout.on('data', d => output += d); server.stderr.on('data', d => output += d); for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw Error(output); try { if ((await fetch(base)).ok) return; } catch { } await sleep(100); } throw Error('Server not ready ' + output); }
async function stop() { if (!server || server.exitCode !== null) return; const ended = new Promise(r => server.once('exit', r)); server.kill(); await ended; }
class Client { cookies = new Map(); async req(url, method = 'GET', body, status = 200, headers = {}) { const form = body instanceof FormData, raw = Buffer.isBuffer(body); const r = await fetch(base + '/api' + url, { method, headers: { ...headers, ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...(body !== undefined && !form && !raw ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : form || raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(60000) }); for (const cookie of r.headers.getSetCookie()) { const pair = cookie.split(';')[0], i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } const value = await r.json().catch(() => null); assert.equal(r.status, status, `${method} ${url}: ${JSON.stringify(value)}`); return value; } }
const upload = (client, name, content, status) => { const form = new FormData(); form.append('files', new Blob([content]), name); return client.req('/files', 'POST', form, status); };
// EICAR standard antivirus test file: harmless, detected by every scanner. Built at runtime so this file is not flagged.
const eicar = Buffer.from('X5O!P%@AP[4' + String.fromCharCode(92) + 'PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const owner = new Client();
try {
  // A file uploaded before ClamAV was configured stays "not-scanned" until the scan-existing script runs.
  await start('', '');
  await owner.req('/auth/register', 'POST', { name: 'Antivirus Owner', email: 'owner@antivirus.test', password: 'antivirus-password-1' });
  const legacyId = (await upload(owner, 'before-clamav.txt', Buffer.from('Uploaded before antivirus'), 201)).ids[0];
  check((await owner.req(`/files/${legacyId}`)).scan.status === 'not-configured', 'File uploaded before ClamAV is not scanned');
  await stop(); await start(clamHost, clamPort, 'true');
  await owner.req(`/files/${legacyId}/content`, 'GET', undefined, 403);
  const scanned = spawnSync(process.execPath, ['scripts/scan-existing.mjs'], { env: { ...process.env, DATABASE_BACKEND: 'sqlite', BLOB_BACKEND: 'local', REDIS_ENABLED: 'false', NEXAFILE_DATA_DIR: storage, CLAMAV_HOST: clamHost, CLAMAV_PORT: clamPort, CLAMAV_SOCKET: '' }, encoding: 'utf8', windowsHide: true });
  check(scanned.status === 0 && /1 clean/.test(scanned.stdout), 'scan-existing scans older files: ' + scanned.stdout + scanned.stderr);
  check((await owner.req(`/files/${legacyId}`)).scan.status === 'clean', 'Older file recorded clean after scan-existing');
  await owner.req(`/files/${legacyId}/content`);
  check(true, 'Required mode opens older file once it is scanned clean');
  const admin = await owner.req('/admin');
  check(admin.system.antivirus.configured, 'Admin overview reports antivirus configured');
  const clean = await upload(owner, 'clean.txt', Buffer.from('Clean document for antivirus check'), 201);
  const cleanId = clean.ids[0];
  check(cleanId, 'Clean upload accepted');
  check((await owner.req(`/files/${cleanId}`)).scan.status === 'clean', 'Clean upload recorded as scanned clean');
  check((await owner.req(`/files/${cleanId}/scan`, 'POST', {})).status === 'clean', 'Manual rescan reports clean');
  const rejected = await upload(owner, 'eicar.txt', eicar, 422);
  check(/malware/i.test(rejected.error), 'EICAR upload rejected as malware');
  const hash = createHash('sha256').update(eicar).digest('hex');
  const session = await owner.req('/uploads', 'POST', { name: 'eicar-resumable.txt', size: eicar.length, hash }, 201);
  await owner.req('/uploads/' + session.id, 'PUT', eicar, 200, { 'X-Upload-Offset': '0' });
  await owner.req('/uploads/' + session.id + '/complete', 'POST', {}, 422);
  check(!(await owner.req('/workspace')).files.some(f => /eicar/i.test(f.name)), 'Infected files never appear in the workspace (simple and resumable uploads)');
  await stop(); await start('127.0.0.1', '1');
  const unavailable = await upload(owner, 'while-down.txt', Buffer.from('ClamAV unreachable'), 503);
  check(/antivirus/i.test(unavailable.error), 'Uploads fail closed when ClamAV is unreachable');
  console.log(`PASS: ${checks} antivirus checks against ClamAV at ${clamHost}:${clamPort}. Isolated data: ${storage}`);
} catch (error) { console.error(error); console.error(output.slice(-3000)); process.exitCode = 1; } finally { await stop(); }
