import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { request as httpRequest } from 'node:http';
const base = 'http://127.0.0.1:3107', storage = await mkdtemp(path.join(os.tmpdir(), 'nexafile-integration-'));
let server, output = '', checks = 0;
async function start() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3107', '-H', '127.0.0.1'], { cwd: process.cwd(), env: { ...process.env, DATABASE_BACKEND:'sqlite', BLOB_BACKEND:'local', REDIS_ENABLED:'false', NEXAFILE_DEMO: 'false', CLAMAV_HOST: '', CLAMAV_SOCKET: '', ANTIVIRUS_REQUIRED: 'false', NEXAFILE_BACKUPS: 'off', DISABLE_REGISTRATION: 'false', NEXAFILE_DATA_DIR: storage, APP_URL: '', NEXAFILE_QUOTA_MB: '2', NEXAFILE_MAX_UPLOAD_MB: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
  const startedAt = output.length;
  for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(output); if (output.slice(startedAt).includes('Ready')) { try { if ((await fetch(base, { headers: { Connection: 'close' } })).ok) return; } catch {} } await sleep(100); } throw new Error(`Server did not start: ${output}`);
}
async function stop() { if (!server || server.exitCode !== null) return; const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited; }
function check(value, message) { assert.ok(value, message); checks++; }
class Client {
  cookie = '';
  async request(url, method = 'GET', body, status = 200, origin = base, extra = {}) {
    const headers = { Connection: 'close', ...extra, ...(this.cookie ? { cookie: this.cookie } : {}), ...(method !== 'GET' ? { origin } : {}) };
    if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    // Use a new HTTP connection per check, including after deliberate rejected uploads and server restarts.
    const encoded = new Request(base + '/api' + url, { method, headers, body });
    const payload = body === undefined ? null : Buffer.from(await encoded.arrayBuffer());
    const wireHeaders = Object.fromEntries(encoded.headers);
    if (payload) wireHeaders['Content-Length'] = String(payload.length);
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(base + '/api' + url, { method, headers: wireHeaders, agent: false }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      });
      request.on('error', error => reject(new Error(`Network failure at ${method} ${url}: ${error.message}`)));
      request.end(payload);
    });
    const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0];
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, status, `${method} ${url}: ${JSON.stringify(data)}`); checks++; return { data, response };
  }
  async upload(name, content, folderId, status = 201, versionId) { const form = new FormData(); form.append(versionId ? 'file' : 'files', new Blob([content]), name); if (folderId) form.append('folderId', String(folderId)); return this.request(versionId ? `/files/${versionId}/versions` : '/files', 'POST', form, status); }
}
function fixturePdf(text) {
  const stream = `BT /F1 16 Tf 45 740 Td (${text}) Tj ET`, objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; } const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(pdf);
}
function officeZip(kind) {
  const zip = new AdmZip();
  if (kind === 'docx') {
    zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
    zip.addFile('_rels/.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
    zip.addFile('word/document.xml', Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Orchid customer research notes</w:t></w:r></w:p></w:body></w:document>'));
  } else zip.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Marigold roadmap presentation</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'));
  return zip.toBuffer();
}
try {
  await start(); const owner = new Client(), other = new Client(), stranger = new Client(), anonymous = new Client();
  await anonymous.request('/workspace', 'GET', undefined, 401);
  await anonymous.request('/auth/register', 'POST', { name: 'Short Password', email: 'short@example.test', password: 'short' }, 400);
  const account = { name: 'Test Owner', email: 'owner@example.test', password: 'test-password-12345' };
  const registration = await owner.request('/auth/register', 'POST', account);
  check(registration.response.headers.get('set-cookie').includes('HttpOnly'), 'HTTP-only session cookie');
  check(registration.response.headers.get('set-cookie').includes('SameSite=strict'), 'Strict same-site session cookie');
  await other.request('/auth/register', 'POST', { name: 'Test Collaborator', email: 'collaborator@example.test', password: 'test-password-98765' });
  await stranger.request('/auth/register', 'POST', { name: 'Test Stranger', email: 'stranger@example.test', password: 'test-password-98765' });
  await anonymous.request('/auth/login', 'POST', { email: account.email, password: 'wrong-password-123' }, 401);
  let workspace = (await owner.request('/workspace')).data;
  check(workspace.files.length === 0 && workspace.folders.length === 5, 'New accounts have empty real workspaces');
  const workFolder = workspace.folders[0].id, folderId = (await owner.request('/folders', 'POST', { name: 'Integration Research', color: 'green' }, 201)).data.id;
  await owner.request('/folders', 'POST', { name: 'Integration Research', color: 'green' }, 409);
  await owner.request(`/folders/${folderId}`, 'PATCH', { name: 'Research Files' });
  await owner.request(`/folders/${folderId}`, 'PATCH', { color: 'teal' }); await owner.request(`/folders/${folderId}`, 'PATCH', { color: 'neon' }, 400); await owner.request(`/folders/${folderId}`, 'PATCH', {}, 400); await other.request(`/folders/${folderId}`, 'PATCH', { color: 'red' }, 404);
  check((await owner.request('/workspace')).data.folders.find(f => f.id === folderId)?.color === 'teal', 'Folder colour can be changed; unknown colours rejected');
  await owner.request('/folders', 'POST', { name: 'Gray Folder', color: 'gray' }, 201); await owner.request('/folders', 'POST', { name: 'Bad Folder', color: 'neon' }, 400);
  const original = 'Private orchid budget 48000. Customer feedback: improve search. เอกสารทดสอบภาษาไทย';
  const fileId = (await owner.upload('Research Notes.txt', original, folderId)).data.ids[0];
  check((await owner.request(`/files/${fileId}/content`)).data.toString() === original, 'Downloads match original bytes');
  const range = await owner.request(`/files/${fileId}/content`, 'GET', undefined, 206, base, { range: 'bytes=0-6' });
  check(range.data.toString() === 'Private' && range.response.headers.get('content-range').startsWith('bytes 0-6/'), 'Media range requests');
  await owner.request(`/files/${fileId}/content`, 'GET', undefined, 416, base, { range: 'bytes=999999-' });
  await anonymous.request(`/files/${fileId}/content`, 'GET', undefined, 401); await other.request(`/files/${fileId}`, 'GET', undefined, 404); await other.request(`/files/${fileId}/content`, 'GET', undefined, 404);
  check(!(await other.request('/workspace')).data.files.some(f => f.id === fileId), 'Private file isolation');
  check((await owner.request('/search?q=48000')).data.ids.includes(fileId), 'Content search');
  check((await owner.request('/search?q=' + encodeURIComponent('ภาษาไทย'))).data.ids.includes(fileId), 'Thai content search');
  await owner.request(`/files/${fileId}`, 'PATCH', { favorite: true, tags: ['Research', 'Budget'], name: 'Renamed Notes.txt' });
  await owner.request(`/files/${fileId}`, 'PATCH', { name: '../outside.txt' }, 400); await owner.request(`/files/${fileId}`, 'PATCH', { name: 'bad.pdf' }, 400);
  await owner.request(`/files/${fileId}`, 'PATCH', { tags: ['attacker'] }, 403, 'https://attacker.invalid'); await owner.request(`/files/${fileId}`, 'PATCH', { tags: ['no origin'] }, 403, '');
  let d = (await owner.request(`/files/${fileId}`)).data;
  check(d.file.favorite && d.file.tags.includes('Budget') && d.activities.some(a => a.action.includes('Renamed')), 'Metadata and audit history');
  const share = (await owner.request(`/files/${fileId}/shares`, 'POST', { email: 'collaborator@example.test', permission: 'viewer' })).data.shares[0];
  check((await other.request(`/files/${fileId}`)).data.file.permission === 'viewer', 'Viewer grants');
  await other.request(`/files/${fileId}`, 'PATCH', { tags: ['unauthorized'] }, 403); await other.upload('new.txt', 'unauthorized', undefined, 403, fileId);
  await other.request(`/files/${fileId}/shares`, 'POST', { email: 'stranger@example.test', permission: 'editor' }, 403);
  await other.request(`/files/${fileId}`, 'PATCH', { favorite: true }); await owner.request(`/files/${fileId}`, 'PATCH', { favorite: false });
  check((await other.request(`/files/${fileId}`)).data.file.favorite, 'Per-account favorites');
  await owner.request(`/files/${fileId}/shares`, 'POST', { email: 'collaborator@example.test', permission: 'editor' }); await other.request(`/files/${fileId}`, 'PATCH', { tags: ['Editor tag'] });
  await other.upload('revision.txt', 'Updated version: lilac budget 52000', undefined, 201, fileId); d = (await owner.request(`/files/${fileId}`)).data;
  check(d.file.version === 2 && d.versions.length === 2 && d.text.includes('52000'), 'Editor version upload');
  await other.request(`/files/${fileId}`, 'PATCH', { deleted: true }, 403); await other.request(`/files/${fileId}`, 'PATCH', { folderId: workFolder }, 403);
  const firstVersion = d.versions.find(v => v.number === 1);
  check((await owner.request(`/files/${fileId}/content?version=${firstVersion.id}`)).data.toString() === original, 'Old version download');
  await owner.request(`/files/${fileId}/versions`, 'PATCH', { versionId: firstVersion.id }); d = (await owner.request(`/files/${fileId}`)).data;
  check(d.file.version === 3 && d.text === original, 'Non-destructive version restore');
  await owner.request(`/files/${fileId}/shares?shareId=${share.id}`, 'DELETE'); await other.request(`/files/${fileId}/content`, 'GET', undefined, 404);
  const folderShare = (await owner.request(`/folders/${folderId}/shares`, 'POST', { email: 'collaborator@example.test', permission: 'editor' })).data.shares[0];
  check((await other.request(`/files/${fileId}`)).data.file.permission === 'editor', 'Inherited folder grants');
  const collaboratorFile = (await other.upload('Team Notes.txt', 'Shared folder upload', folderId)).data.ids[0];
  check((await owner.request(`/files/${collaboratorFile}`)).data.file.ownerId === workspace.user.id, 'Shared-folder upload ownership');
  await owner.request(`/folders/${folderId}`, 'DELETE', undefined, 409); await owner.request(`/folders/${folderId}/shares?shareId=${folderShare.id}`, 'DELETE'); await other.request(`/files/${collaboratorFile}`, 'GET', undefined, 404);
  const duplicateId = (await owner.upload('Different Name.txt', original)).data.ids[0]; workspace = (await owner.request('/workspace')).data;
  check(workspace.files.find(f => f.id === fileId).hash === workspace.files.find(f => f.id === duplicateId).hash, 'Content-hash duplicate detection');
  await owner.request('/files/bulk', 'PATCH', { items: [{ id: fileId, changes: { folderId: workFolder } }, { id: duplicateId, changes: { folderId: workFolder } }] });
  const foreignId = (await stranger.upload('secret.txt', 'private stranger data')).data.ids[0];
  await owner.request('/files/bulk', 'PATCH', { items: [{ id: fileId, changes: { name: 'Must Roll Back.txt' } }, { id: foreignId, changes: { deleted: true } }] }, 404);
  check((await owner.request(`/files/${fileId}`)).data.file.name === 'Renamed Notes.txt', 'Atomic bulk rollback');
  await owner.request(`/files/${fileId}`, 'PATCH', { deleted: true }); check((await owner.request(`/files/${fileId}`)).data.file.deleted, 'Persistent trash');
  await owner.upload('new.txt', 'no', undefined, 403, fileId); await owner.request(`/files/${fileId}`, 'PATCH', { deleted: false }); check(!(await owner.request(`/files/${fileId}`)).data.file.deleted, 'Trash restore');
  await owner.request(`/files/${duplicateId}`, 'DELETE', { confirmName: 'Different Name.txt' }, 403);
  await owner.request(`/files/${duplicateId}`, 'PATCH', { deleted: true });
  await owner.request(`/files/${duplicateId}`, 'DELETE', { confirmName: 'wrong confirmation' }, 400);
  await owner.request(`/files/${duplicateId}`, 'DELETE', { confirmName: 'Different Name.txt' });
  await owner.request(`/files/${duplicateId}/content`, 'GET', undefined, 404);
  check((await owner.request(`/files/${fileId}/content`)).data.toString() === original, 'Purging a duplicate preserves another file’s shared blob');
  await owner.upload('spoof.pdf', 'not a PDF', undefined, 400); await owner.upload('spoof.png', 'not a PNG', undefined, 400); await owner.upload('oversized.txt', Buffer.alloc(1048577), undefined, 413);
  const pdfId = (await owner.upload('Report.pdf', fixturePdf('Hibiscus annual report'))).data.ids[0]; check((await owner.request(`/files/${pdfId}`)).data.text.includes('Hibiscus'), 'PDF extraction');
  const pdfPreview = await owner.request(`/files/${pdfId}/preview?page=1`);
  check(pdfPreview.response.headers.get('content-type') === 'image/png' && pdfPreview.data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'PDF page rendering returns an actual PNG');
  await stranger.request(`/files/${pdfId}/preview`, 'GET', undefined, 404);
  await owner.request(`/files/${pdfId}/preview?page=0`, 'GET', undefined, 400);
  const docxId = (await owner.upload('Notes.docx', officeZip('docx'))).data.ids[0]; check((await owner.request(`/files/${docxId}`)).data.text.includes('Orchid'), 'DOCX extraction');
  const pptxId = (await owner.upload('Roadmap.pptx', officeZip('pptx'))).data.ids[0]; check((await owner.request(`/files/${pptxId}`)).data.text.includes('Marigold'), 'PPTX extraction');
  const book = new ExcelJS.Workbook(); book.addWorksheet('Budget').addRow(['Tulip forecast', 64000]); const xlsxId = (await owner.upload('Budget.xlsx', await book.xlsx.writeBuffer())).data.ids[0]; check((await owner.request(`/files/${xlsxId}`)).data.text.includes('64000'), 'XLSX extraction');
  const imageId = (await owner.upload('pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=', 'base64'))).data.ids[0]; check((await owner.request(`/files/${imageId}/content`)).response.headers.get('content-type') === 'image/png', 'Image preview media type');
  const svgId = (await owner.upload('unsafe.svg', '<svg><script>alert(1)</script></svg>')).data.ids[0]; check((await owner.request(`/files/${svgId}/content`)).response.headers.get('content-type') === 'text/plain', 'Active SVG is inert text');
  const beforeBatch = (await owner.request('/workspace')).data.files.length;
  const oversizedBatch = new FormData(); oversizedBatch.append('files', new Blob([Buffer.alloc(1048576)]), 'first.bin'); oversizedBatch.append('files', new Blob([Buffer.alloc(1048576)]), 'second.bin');
  await owner.request('/files', 'POST', oversizedBatch, 413);
  check((await owner.request('/workspace')).data.files.length === beforeBatch, 'Over-quota batches do not partially commit');
  const zipA = (await owner.upload('zip-a.txt', 'alpha')).data.ids[0], zipB = (await owner.upload('zip-a.txt', 'beta')).data.ids[0];
  const zipped = new AdmZip((await owner.request('/files/zip', 'POST', { ids: [zipA, zipB] })).data);
  check(zipped.getEntries().map(e => e.entryName).sort().join() === 'zip-a (2).txt,zip-a.txt', 'ZIP download renames duplicate names');
  check(zipped.readAsText('zip-a.txt') === 'alpha' && zipped.readAsText('zip-a (2).txt') === 'beta', 'ZIP download contains original content');
  await owner.request('/files/zip', 'POST', { ids: [] }, 400);
  await owner.request('/files/zip', 'POST', { ids: [zipA] }, 403, 'http://evil.example');
  await owner.upload('quota-fill.bin', Buffer.alloc(1048576));
  await owner.upload('quota-over.bin', Buffer.alloc(1048576), undefined, 413);
  const before = (await owner.request('/workspace')).data;
  check(before.used === before.files.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(original) + Buffer.byteLength('Updated version: lilac budget 52000'), 'Quota accounts for saved versions');
  await stop(); await start(); const persisted = (await owner.request('/workspace')).data;
  check(persisted.files.length === before.files.length, 'Data and sessions survive a server restart'); check((await owner.request(`/files/${fileId}/content`)).data.toString() === original, 'Blob persistence after restart');
  const oldCookie = owner.cookie; await owner.request('/auth/logout', 'POST'); owner.cookie = oldCookie; await owner.request('/workspace', 'GET', undefined, 401);
  await owner.request('/auth/login', 'POST', { email: account.email, password: account.password }); await owner.request('/workspace');
  const db = new DatabaseSync(path.join(storage, 'nexafile.sqlite')), record = db.prepare('SELECT password FROM users WHERE email=?').get(account.email);
  check(!record.password.includes(account.password) && record.password.includes(':'), 'Passwords are salted hashes'); db.close();
  console.log(`PASS: ${checks} integration checks. Isolated test data: ${storage}`);
} catch (error) { console.error(error); console.error(output.slice(-6000)); process.exitCode = 1; } finally { await stop(); }
