import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import AdmZip from 'adm-zip';
// data:export from one isolated install, data:import into another (SQLite/local storage, port 3115).
const base = 'http://127.0.0.1:3115', root = await mkdtemp(path.join(os.tmpdir(), 'nexafile-transfer-'));
const source = path.join(root, 'source'), target = path.join(root, 'target'), archive = path.join(root, 'export.zip');
let server, output = '', checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const env = (dir, extra = {}) => ({ ...process.env, DATABASE_BACKEND: 'sqlite', BLOB_BACKEND: 'local', REDIS_ENABLED: 'false', NEXAFILE_DATA_DIR: dir, NEXAFILE_BACKUPS: 'off', NEXAFILE_DEMO: 'false', APP_URL: base, CLAMAV_HOST: '', CLAMAV_SOCKET: '', ANTIVIRUS_REQUIRED: 'false', DISABLE_REGISTRATION: 'false', ...extra });
async function start(dir, extra) { output = ''; server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3115', '-H', '127.0.0.1'], { env: env(dir, extra), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); server.stdout.on('data', d => output += d); server.stderr.on('data', d => output += d); for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw Error(output); try { if ((await fetch(base)).ok) return; } catch { } await sleep(100); } throw Error('Server not ready ' + output); }
async function stop() { if (!server || server.exitCode !== null) return; const ended = new Promise(r => server.once('exit', r)); server.kill(); await ended; }
const script = (name, dir, ...args) => spawnSync(process.execPath, ['scripts/' + name, ...args], { env: env(dir), encoding: 'utf8', windowsHide: true });
function code(secret, step = Math.floor(Date.now() / 30000)) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0'); const key = Buffer.from(bits.match(/.{8}/g).map(v => parseInt(v, 2))); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', key).update(counter).digest(), offset = h[19] & 15; return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0'); }
class Client { cookies = new Map(); async req(url, method = 'GET', body, status = 200) { const form = body instanceof FormData; const r = await fetch(base + '/api' + url, { method, headers: { ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) }); for (const cookie of r.headers.getSetCookie()) { const pair = cookie.split(';')[0], i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } const value = url.endsWith('/content') ? Buffer.from(await r.arrayBuffer()) : await r.json().catch(() => null); assert.equal(r.status, status, `${method} ${url}: ${value}`); return value; } }
const account = { name: 'Transfer Owner', email: 'owner@transfer.test', password: 'transfer-password-1' };
try {
  await start(source);
  const owner = new Client(); await owner.req('/auth/register', 'POST', account);
  const form = new FormData(); form.append('files', new Blob(['Quarterly numbers']), 'report.txt'); form.append('files', new Blob(['Meeting notes, ภาษาไทย']), 'notes.txt');
  const ids = (await owner.req('/files', 'POST', form, 201)).ids;
  const mfa = await owner.req('/auth/mfa-setup', 'POST', { currentPassword: account.password });
  const enableStep = Math.floor(Date.now() / 30000);
  await owner.req('/auth/mfa-enable', 'POST', { currentPassword: account.password, code: code(mfa.secret, enableStep) });
  await stop();

  const exported = script('export-data.mjs', source, archive);
  check(exported.status === 0 && /"files": 2/.test(exported.stdout), 'Export writes an archive with both files: ' + exported.stdout + exported.stderr);
  const zip = new AdmZip(archive), manifest = JSON.parse(zip.getEntry('manifest.json').getData().toString());
  check(manifest.hashes.length === 2 && manifest.keyHash && !manifest.counts.sessions, 'Archive has file contents and server.key but no sessions');

  // The target already has a real member: import must refuse unless --replace.
  await start(target); await new Client().req('/auth/register', 'POST', { name: 'Existing', email: 'existing@transfer.test', password: 'existing-password-1' }); await stop();
  const refused = script('import-data.mjs', target, archive);
  check(refused.status !== 0 && /--replace/.test(refused.stderr), 'Import refuses to overwrite a system with members: ' + refused.stderr);

  const tampered = path.join(root, 'tampered.zip'), bad = new AdmZip(archive); bad.updateFile('blobs/' + manifest.hashes[0], Buffer.from('changed')); bad.writeZip(tampered);
  const rejected = script('import-data.mjs', target, tampered, '--replace');
  check(rejected.status !== 0 && /integrity/.test(rejected.stderr), 'Import rejects a modified archive: ' + rejected.stderr);

  const imported = script('import-data.mjs', target, archive, '--replace');
  check(imported.status === 0 && /"imported": true/.test(imported.stdout), 'Import with --replace succeeds: ' + imported.stdout + imported.stderr);
  check((await readFile(path.join(target, 'server.key'))).equals(await readFile(path.join(source, 'server.key'))), 'server.key copied so 2FA secrets still decrypt');

  await start(target);
  await new Client().req('/auth/login', 'POST', { email: 'existing@transfer.test', password: 'existing-password-1' }, 401);
  check(true, 'Replaced members are gone');
  const login = new Client(); check((await login.req('/auth/login', 'POST', { email: account.email, password: account.password })).mfaRequired, 'Imported account keeps its password and 2FA');
  while (Math.floor(Date.now() / 30000) === enableStep) await sleep(500); // a TOTP step can be used only once
  await login.req('/auth/login', 'POST', { email: account.email, password: account.password, code: code(mfa.secret) });
  check(true, 'Authenticator code works after import (encryption key carried over)');
  const files = (await login.req('/workspace')).files;
  check(files.length === 2 && ids.every(id => files.some(f => f.id === id)), 'Workspace lists imported files with the same IDs');
  check((await login.req(`/files/${ids[1]}/content`)).toString() === 'Meeting notes, ภาษาไทย', 'Imported file content opens');
  console.log(`PASS: ${checks} export/import checks. Isolated data: ${root}`);
} catch (error) { console.error(error); console.error(output.slice(-3000)); process.exitCode = 1; } finally { await stop(); }
