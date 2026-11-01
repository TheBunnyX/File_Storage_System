import { workerEnvironment } from './worker-env';
import { putBlob, readBlob, localBlob } from './blobs';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { all, one, run, transaction, blobDirectory, cleanName, requireValue, HttpError } from './db';
import { FOLDER_COLORS, formatBytes, type Activity, type FileDetails, type FileItem, type FolderItem, type Permission, type Share, type User, type Version } from './types';
import { audit, quotaFor } from './security';
import { maxUploadBytes } from './settings';
import { recordScan, requireCleanContent, scanBytes, scanStatus } from './antivirus';
export type FileRow = {
    id: number;
    owner_id: number;
    folder_id: number | null;
    name: string;
    tags: string;
    type: string;
    mime: string;
    bytes: number;
    hash: string;
    text: string;
    extraction_status: string;
    version: number;
    deleted: number;
    created: string;
    modified: string;
};
type FolderRow = {
    id: number;
    owner_id: number;
    name: string;
    color: string;
    created: string;
};
// Matches owners in the same storage pool as `?` (bound twice): the whole department, or just the owner.
export const poolOwners = (column: string) => `(${column}=? OR ${column} IN (SELECT p.user_id FROM account_profiles p JOIN account_profiles o ON o.department=p.department WHERE o.user_id=? AND o.department<>''))`;
const now = () => new Date().toISOString();
export async function activity(user: User, fileId: number | null, ownerId: number, action: string) { (await run('INSERT INTO activities(file_id,owner_id,actor_id,action,created) VALUES(?,?,?,?,?)', fileId, ownerId, user.id, action, now())); (await audit(user.id, 'workspace.activity', `${fileId || 'folder'}:${action}`)); }
export async function folderAccess(user: User, id: number): Promise<{
    folder: FolderRow;
    permission: Permission;
}> {
    const folder = (await one<FolderRow>('SELECT * FROM folders WHERE id=?', id));
    requireValue(folder, 'Folder not found.', 404);
    const permission = folder.owner_id === user.id ? 'owner' : (await one<{
        permission: Permission;
    }>("SELECT permission FROM shares WHERE kind='folder' AND resource_id=? AND user_id=?", id, user.id))?.permission;
    requireValue(permission, 'Folder not found.', 404);
    return { folder, permission };
}
export async function fileAccess(user: User, id: number): Promise<{
    row: FileRow;
    permission: Permission;
}> {
    const row = (await one<FileRow>('SELECT * FROM files WHERE id=?', id));
    requireValue(row, 'File not found.', 404);
    if (row.owner_id === user.id)
        return { row, permission: 'owner' };
    requireValue(!row.deleted, 'File not found.', 404);
    const grants = (await all<{
        permission: Permission;
    }>("SELECT permission FROM shares WHERE user_id=? AND ((kind='file' AND resource_id=?) OR (kind='folder' AND resource_id=?))", user.id, id, row.folder_id));
    requireValue(grants.length, 'File not found.', 404);
    return { row, permission: grants.some(s => s.permission === 'editor') ? 'editor' : 'viewer' };
}
export async function accessibleFiles(user: User) {
    return (await all<FileRow>(`SELECT DISTINCT f.* FROM files f WHERE f.owner_id=? OR (f.deleted=0 AND EXISTS (SELECT 1 FROM shares s WHERE s.user_id=? AND ((s.kind='file' AND s.resource_id=f.id) OR (s.kind='folder' AND s.resource_id=f.folder_id)))) ORDER BY f.modified DESC,f.id DESC`, user.id, user.id));
}
// Project only the excerpt and resolve metadata in one query, regardless of file count.
export async function workspaceFiles(user: User): Promise<FileItem[]> {
    const rows = await all<FileRow & { folder_name: string | null; owner_name: string; permission: Permission; favorite: number; shared: number }>(`
      SELECT f.id,f.owner_id,f.folder_id,f.name,f.tags,f.type,f.mime,f.bytes,f.hash,
        SUBSTR(f.text,1,300) AS text,f.extraction_status,f.version,f.deleted,f.created,f.modified,
        d.name AS folder_name,u.name AS owner_name,
        CASE WHEN f.owner_id=? THEN 'owner' WHEN EXISTS(SELECT 1 FROM shares s WHERE s.user_id=? AND s.permission='editor' AND ((s.kind='file' AND s.resource_id=f.id) OR (s.kind='folder' AND s.resource_id=f.folder_id))) THEN 'editor' ELSE 'viewer' END AS permission,
        EXISTS(SELECT 1 FROM favorites v WHERE v.user_id=? AND v.file_id=f.id) AS favorite,
        EXISTS(SELECT 1 FROM shares s WHERE (s.kind='file' AND s.resource_id=f.id) OR (s.kind='folder' AND s.resource_id=f.folder_id)) AS shared
      FROM files f JOIN users u ON u.id=f.owner_id LEFT JOIN folders d ON d.id=f.folder_id
      WHERE f.owner_id=? OR (f.deleted=0 AND EXISTS(SELECT 1 FROM shares s WHERE s.user_id=? AND ((s.kind='file' AND s.resource_id=f.id) OR (s.kind='folder' AND s.resource_id=f.folder_id))))
      ORDER BY f.modified DESC,f.id DESC`, user.id,user.id,user.id,user.id,user.id);
    return rows.map(row => ({ id:row.id,name:row.name,tags:JSON.parse(row.tags),type:row.type,mime:row.mime,bytes:row.bytes,modified:row.modified,created:row.created,size:formatBytes(row.bytes),folder:row.folder_name||'Unfiled',folderId:row.folder_id,ownerId:row.owner_id,ownerName:row.owner_name,permission:row.permission,favorite:!!row.favorite,shared:!!row.shared,deleted:!!row.deleted,url:`/api/files/${row.id}/content`,hash:row.hash,version:row.version,excerpt:row.text.slice(0,300),extractionStatus:row.extraction_status }));
}
export async function workspaceActivities(user: User): Promise<Activity[]> {
    return all<Activity>(`SELECT a.id,a.action,u.name AS actor,a.created,f.name AS fileName
      FROM activities a JOIN users u ON u.id=a.actor_id LEFT JOIN files f ON f.id=a.file_id
      WHERE (a.file_id IS NULL AND a.owner_id=?) OR f.owner_id=? OR (f.deleted=0 AND EXISTS(
        SELECT 1 FROM shares s WHERE s.user_id=? AND ((s.kind='file' AND s.resource_id=f.id) OR (s.kind='folder' AND s.resource_id=f.folder_id))))
      ORDER BY a.id DESC LIMIT 30`,user.id,user.id,user.id);
}
export async function serializeFile(user: User, row: FileRow): Promise<FileItem> {
    const folder = row.folder_id ? (await one<FolderRow>('SELECT * FROM folders WHERE id=?', row.folder_id)) : undefined;
    const owner = (await one<User>('SELECT id,name,email FROM users WHERE id=?', row.owner_id))!;
    return { id: row.id, name: row.name, tags: JSON.parse(row.tags), type: row.type, mime: row.mime, bytes: row.bytes, modified: row.modified, created: row.created, size: formatBytes(row.bytes), folder: folder?.name || 'Unfiled', folderId: row.folder_id, ownerId: row.owner_id, ownerName: owner.name, permission: (await fileAccess(user, row.id)).permission, favorite: !!(await one('SELECT 1 FROM favorites WHERE user_id=? AND file_id=?', user.id, row.id)), shared: !!(await one("SELECT 1 FROM shares WHERE (kind='file' AND resource_id=?) OR (kind='folder' AND resource_id=?)", row.id, row.folder_id)), deleted: !!row.deleted, url: `/api/files/${row.id}/content`, hash: row.hash, version: row.version, excerpt: row.text.slice(0, 300), extractionStatus: row.extraction_status };
}
export async function foldersFor(user: User): Promise<FolderItem[]> {
    const rows=await all<FolderRow & {permission:Permission;count:number;shared:number}>(`SELECT f.*,
      CASE WHEN f.owner_id=? THEN 'owner' ELSE (SELECT s.permission FROM shares s WHERE s.kind='folder' AND s.resource_id=f.id AND s.user_id=?) END AS permission,
      (SELECT COUNT(*) FROM files v WHERE v.folder_id=f.id AND v.deleted=0) AS count,
      EXISTS(SELECT 1 FROM shares s WHERE s.kind='folder' AND s.resource_id=f.id) AS shared
      FROM folders f WHERE f.owner_id=? OR EXISTS(SELECT 1 FROM shares s WHERE s.kind='folder' AND s.resource_id=f.id AND s.user_id=?) ORDER BY f.id`,user.id,user.id,user.id,user.id);
    return rows.map(f=>({id:f.id,name:f.name,color:f.color,ownerId:f.owner_id,permission:f.permission,count:Number(f.count),shared:!!f.shared}));
}
export async function usedStorage(userId: number) {
    return Number((await one<{
        used: number;
    }>(`SELECT COALESCE(SUM(v.bytes),0) AS used FROM versions v JOIN files f ON v.file_id=f.id WHERE ${poolOwners('f.owner_id')}`, userId, userId))!.used);
}
// Names the storage pool an owner draws from: their department, or just themselves.
export async function storagePool(ownerId: number) {
    const department = (await one<{ department: string }>('SELECT department FROM account_profiles WHERE user_id=?', ownerId))?.department;
    return department ? `storage-pool:department:${department}` : `storage-pool:user:${ownerId}`;
}
// Holds a row lock on the pool until the surrounding transaction ends, so concurrent quota checks cannot both pass.
// Call it first in the transaction: MySQL takes its read snapshot after the lock is granted.
export async function lockStoragePool(pool: string) {
    (await run('INSERT OR REPLACE INTO operations(key,value) VALUES(?,?)', pool, String(Date.now())));
}
export async function personalStorage(userId: number) {
    return Number((await one<{
        used: number;
    }>('SELECT COALESCE(SUM(v.bytes),0) AS used FROM versions v JOIN files f ON v.file_id=f.id WHERE f.owner_id=?', userId))!.used);
}
export async function sharesFor(kind: string, id: number): Promise<Share[]> { return (await all<Share>('SELECT s.id,u.email,u.name,s.permission FROM shares s JOIN users u ON u.id=s.user_id WHERE s.kind=? AND s.resource_id=?', kind, id)); }
export async function detailsFor(user: User, id: number): Promise<FileDetails> {
    const { row, permission } = (await fileAccess(user, id));
    const versions = (await all<Version & {
        number: number;
    }>('SELECT v.id,v.number,v.name,v.bytes,v.created,u.name AS actor FROM versions v JOIN users u ON u.id=v.actor_id WHERE v.file_id=? ORDER BY v.number DESC', id)).map(v => ({ ...v, current: v.number === row.version }));
    const activities = (await all<Activity>('SELECT a.id,a.action,u.name AS actor,a.created FROM activities a JOIN users u ON u.id=a.actor_id WHERE a.file_id=? ORDER BY a.id DESC LIMIT 100', id));
    return { file: (await serializeFile(user, row)), text: row.text, versions, activities, shares: permission === 'owner' ? (await sharesFor('file', id)) : [], inheritedShares: permission === 'owner' && row.folder_id ? (await sharesFor('folder', row.folder_id)) : [] };
}
export async function createFolder(user: User, name: unknown, color: unknown = 'blue') {
    const validName = cleanName(name, 80);
    requireValue((FOLDER_COLORS as readonly string[]).includes(String(color)), 'Invalid folder color.');
    requireValue(!(await one('SELECT 1 FROM folders WHERE owner_id=? AND name=?', user.id, validName)), 'A folder with this name already exists.', 409);
    const id = Number((await run('INSERT INTO folders(owner_id,name,color,created) VALUES(?,?,?,?)', user.id, validName, String(color), now())).lastInsertRowid);
    (await activity(user, null, user.id, `Created folder “${validName}”`));
    return id;
}
function fileKind(name: string, bytes: Buffer) {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', md: 'text/plain', csv: 'text/plain', json: 'text/plain', log: 'text/plain', html: 'text/plain', css: 'text/plain', js: 'text/plain', ts: 'text/plain', py: 'text/plain', xml: 'text/plain', svg: 'text/plain' };
    let mime = mimeMap[ext] || 'application/octet-stream';
    if (mime === 'application/pdf')
        requireValue(bytes.subarray(0, 5).toString() === '%PDF-', 'This file is not a valid PDF.');
    if (['docx', 'xlsx', 'pptx'].includes(ext))
        requireValue(bytes.subarray(0, 2).toString() === 'PK', 'This file is not a valid Office document.');
    if (mime.startsWith('image/')) {
        const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : mime === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
        requireValue(valid, 'The image contents do not match the file extension.');
    }
    if (mime === 'text/plain' && bytes.includes(0))
        mime = 'application/octet-stream';
    const type = mime.startsWith('image/') ? 'Image' : mime.startsWith('video/') ? 'Video' : mime.startsWith('audio/') ? 'Audio' : ext === 'pdf' ? 'PDF' : ['xlsx', 'csv'].includes(ext) ? 'Spreadsheet' : ext === 'pptx' ? 'Presentation' : ext === 'docx' || mime === 'text/plain' ? 'Document' : 'Other';
    return { type, mime, extension: ext };
}
async function extractText(blobPath: string, extension: string, mime: string, buffer: Buffer): Promise<{
    text: string;
    status: string;
}> {
    if (mime === 'text/plain')
        return { text: buffer.toString('utf8').replace(/\u0000/g, '').slice(0, 100000), status: buffer.length > 100000 ? 'Indexed first 100,000 characters' : 'Indexed' };
    if (!['pdf', 'docx', 'xlsx', 'pptx'].includes(extension))
        return { text: '', status: 'Preview available for supported media; content indexing is not available for this format' };
    if (buffer.length > 12 * 1048576)
        return { text: '', status: 'File saved; text indexing is limited to documents under 12 MB' };
    return new Promise(resolve => {
        const worker = fork(/* turbopackIgnore: true */ path.join(process.cwd(), 'lib', 'extract-worker.cjs'), [JSON.stringify({ path: blobPath, extension })], { execArgv: ['--max-old-space-size=192'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', windowsHide: true, env: workerEnvironment() });
        let settled = false;
        const finish = (value: {
            text: string;
            status: string;
        }) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => { finish({ text: '', status: 'File saved; indexing timed out' }); worker.kill(); }, 20000);
        worker.on('message', (value: {
            text?: string;
            error?: string;
        }) => finish({ text: value.text || '', status: value.error || (value.text?.trim() ? 'Indexed (up to 50 PDF pages, 500 rows per sheet, or 100 slides)' : 'No extractable text in this file') }));
        worker.on('error', () => finish({ text: '', status: 'File saved; text indexing failed' }));
        worker.on('exit', () => {
            if (!settled)
                finish({ text: '', status: 'File saved; text indexing was interrupted' });
        });
    });
}
export async function prepareUpload(file: File) {
    const name = cleanName(file.name);
    const maxUpload = await maxUploadBytes();
    requireValue(file.size <= maxUpload, `Each file must be smaller than ${formatBytes(maxUpload)}.`, 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = fileKind(name, buffer);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const scan = await scanBytes(buffer);
    (await recordScan(hash, scan));
    // A content hash is the only disk filename, so uploaded names never become paths.
    const blobPath = path.join(blobDirectory, hash);
    await putBlob(hash,buffer);
    const extracted = await extractText(blobPath, kind.extension, kind.mime, buffer);
    const words = name.replace(/\.[^.]+$/, '').split(/[\s_\-]+/).filter(w => w.length >= 3 && w.length <= 25).slice(0, 3);
    return { name, hash, type: kind.type, mime: kind.mime, bytes: buffer.length, text: extracted.text, extractionStatus: extracted.status, tags: [...new Set([kind.type, ...words])] };
}
export type PreparedUpload = Awaited<ReturnType<typeof prepareUpload>>;
export async function insertUpload(user: User, data: PreparedUpload, folderId: number | null) {
    let ownerId = user.id;
    if (folderId) {
        const access = (await folderAccess(user, folderId));
        requireValue(access.permission !== 'viewer', 'You have view-only access to this folder.', 403);
        ownerId = access.folder.owner_id;
    }
    requireValue((await usedStorage(ownerId)) + data.bytes <= (await quotaFor(ownerId)), 'This workspace has reached its storage quota.', 413);
    const time = now();
    const id = Number((await run('INSERT INTO files(owner_id,folder_id,name,tags,type,mime,bytes,hash,text,extraction_status,created,modified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ownerId, folderId, data.name, JSON.stringify(data.tags), data.type, data.mime, data.bytes, data.hash, data.text, data.extractionStatus, time, time)).lastInsertRowid);
    (await run('INSERT INTO versions(file_id,number,name,hash,mime,bytes,text,extraction_status,actor_id,created) VALUES(?,1,?,?,?,?,?,?,?,?)', id, data.name, data.hash, data.mime, data.bytes, data.text, data.extractionStatus, user.id, time));
    (await activity(user, id, ownerId, 'Uploaded file'));
    return id;
}
export async function updateFile(user: User, id: number, changes: Record<string, unknown>) {
    const { row, permission } = (await fileAccess(user, id));
    const keys = Object.keys(changes);
    requireValue(keys.length && keys.every(k => ['name', 'tags', 'folderId', 'favorite', 'deleted'].includes(k)), 'Unsupported file change.');
    if (keys.some(k => k !== 'favorite'))
        requireValue(permission !== 'viewer', 'You have view-only access to this file.', 403);
    if ('deleted' in changes || 'folderId' in changes)
        requireValue(permission === 'owner', 'Only the owner can move or delete a file.', 403);
    if ('favorite' in changes) {
        requireValue(typeof changes.favorite === 'boolean', 'Invalid favorite value.');
        if (changes.favorite)
            (await run('INSERT OR IGNORE INTO favorites(user_id,file_id) VALUES(?,?)', user.id, id));
        else
            (await run('DELETE FROM favorites WHERE user_id=? AND file_id=?', user.id, id));
    }
    if ('name' in changes) {
        const name = cleanName(changes.name);
        requireValue(path.extname(name).toLowerCase() === path.extname(row.name).toLowerCase(), 'Keep the original file extension when renaming.');
        (await run('UPDATE files SET name=?,modified=? WHERE id=?', name, now(), id));
        (await activity(user, id, row.owner_id, `Renamed to “${name}”`));
    }
    if ('tags' in changes) {
        requireValue(Array.isArray(changes.tags) && changes.tags.length <= 15 && changes.tags.every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 40), 'Use up to 15 tags of 1–40 characters.');
        const tags = [...new Set(changes.tags.map((t: string) => t.trim()))];
        (await run('UPDATE files SET tags=?,modified=? WHERE id=?', JSON.stringify(tags), now(), id));
        (await activity(user, id, row.owner_id, 'Updated tags'));
    }
    if ('folderId' in changes) {
        const fid = changes.folderId === null ? null : Number(changes.folderId);
        if (fid !== null) {
            requireValue(Number.isSafeInteger(fid) && fid > 0, 'Invalid folder.');
            requireValue((await folderAccess(user, fid)).folder.owner_id === user.id, 'Move files only into a folder you own.', 403);
        }
        (await run('UPDATE files SET folder_id=?,modified=? WHERE id=?', fid, now(), id));
        (await activity(user, id, row.owner_id, `Moved to ${fid ? (await one<FolderRow>('SELECT * FROM folders WHERE id=?', fid))!.name : 'Unfiled'}`));
    }
    if ('deleted' in changes) {
        requireValue(typeof changes.deleted === 'boolean', 'Invalid deletion value.');
        (await run('UPDATE files SET deleted=?,modified=? WHERE id=?', changes.deleted ? 1 : 0, now(), id));
        (await activity(user, id, row.owner_id, changes.deleted ? 'Moved to Trash' : 'Restored from Trash'));
    }
}
export async function addVersion(user: User, id: number, data: PreparedUpload) {
    const { row, permission } = (await fileAccess(user, id));
    requireValue(permission !== 'viewer', 'You have view-only access to this file.', 403);
    requireValue(!row.deleted, 'Restore this file before uploading a new version.');
    requireValue(path.extname(data.name).toLowerCase() === path.extname(row.name).toLowerCase(), 'A new version must use the same file extension.');
    requireValue((await usedStorage(row.owner_id)) + data.bytes <= (await quotaFor(row.owner_id)), 'This workspace has reached its storage quota.', 413);
    const version = row.version + 1;
    const time = now();
    (await run('INSERT INTO versions(file_id,number,name,hash,mime,bytes,text,extraction_status,actor_id,created) VALUES(?,?,?,?,?,?,?,?,?,?)', id, version, row.name, data.hash, data.mime, data.bytes, data.text, data.extractionStatus, user.id, time));
    (await run('UPDATE files SET hash=?,mime=?,bytes=?,text=?,extraction_status=?,version=?,modified=? WHERE id=?', data.hash, data.mime, data.bytes, data.text, data.extractionStatus, version, time, id));
    (await activity(user, id, row.owner_id, `Uploaded version ${version}`));
}
export async function restoreVersion(user: User, id: number, versionId: number) {
    const { row, permission } = (await fileAccess(user, id));
    requireValue(permission !== 'viewer', 'You have view-only access to this file.', 403);
    requireValue(!row.deleted, 'Restore the file from Trash first.');
    const v = (await one<{
        name: string;
        hash: string;
        mime: string;
        bytes: number;
        text: string;
        extraction_status: string;
        number: number;
    }>('SELECT * FROM versions WHERE id=? AND file_id=?', versionId, id));
    requireValue(v, 'Version not found.', 404);
    (await addVersion(user, id, { name: row.name, hash: v.hash, type: row.type, mime: v.mime, bytes: v.bytes, text: v.text, extractionStatus: v.extraction_status, tags: JSON.parse(row.tags) }));
    (await activity(user, id, row.owner_id, `Restored content from version ${v.number}`));
}
export async function contentResponse(user: User, id: number, request: Request) {
    const { row } = (await fileAccess(user, id));
    const url = new URL(request.url);
    const versionId = url.searchParams.get('version');
    const source = versionId ? (await one<{
        hash: string;
        mime: string;
        bytes: number;
        name: string;
    }>('SELECT hash,mime,bytes,name FROM versions WHERE id=? AND file_id=?', Number(versionId), id)) : row;
    requireValue(source, 'Version not found.', 404);
    (await requireCleanContent(source.hash));
    (await audit(user.id, 'file.opened', `${row.id}:${url.searchParams.has('download') ? 'download' : 'preview'}`));
    const bytes = await readBlob(source.hash);
    const inline = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm)|audio\/(mpeg|wav|ogg)|application\/pdf|text\/plain)$/.test(source.mime) && !url.searchParams.has('download');
    const headers = new Headers({ 'Content-Type': inline ? source.mime : 'application/octet-stream', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g, '%27')}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Accept-Ranges': 'bytes' });
    const range = request.headers.get('range');
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]))
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
        const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
        const end = match[1] ? match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1 : bytes.length - 1;
        if (start >= bytes.length || start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end))
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
        headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        headers.set('Content-Length', String(end - start + 1));
        return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers });
    }
    headers.set('Content-Length', String(bytes.length));
    return new Response(new Uint8Array(bytes), { headers });
}
