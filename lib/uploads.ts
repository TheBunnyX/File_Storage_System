import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { all, cleanName, dataDirectory, HttpError, one, positiveId, requireValue, run, transaction } from './db';
import { addVersion, fileAccess, folderAccess, insertUpload, lockStoragePool, poolOwners, prepareUpload, storagePool, usedStorage } from './storage';
import { maxUploadBytes } from './settings';
import { audit, quotaFor } from './security';
import type { User } from './types';
type Upload = {
    id: string;
    user_id: number;
    owner_id: number;
    folder_id: number | null;
    file_id: number | null;
    name: string;
    size: number;
    offset: number;
    expected_hash: string;
    status: string;
    lease: number;
    expires: number;
    result_id: number | null;
};
const directory = path.join(dataDirectory, 'uploads');
function uploadPath(id: string) { requireValue(/^[a-f0-9-]{36}$/.test(id), 'Invalid upload ID.'); return path.join(directory, `${id}.part`); }
async function owned(user: User, id: string) { uploadPath(id); const upload = (await one<Upload>('SELECT * FROM upload_sessions WHERE id=? AND user_id=?', id, user.id)); requireValue(upload && upload.expires > Date.now(), 'Upload session expired. Select the file to start again.', 404); return upload; }
async function authorize(user: User, upload: Upload) {
    if (upload.file_id) {
        const access = (await fileAccess(user, upload.file_id));
        requireValue(access.permission !== 'viewer' && !access.row.deleted && access.row.owner_id === upload.owner_id, 'Permission to update this file has changed.', 403);
    }
    else if (upload.folder_id) {
        const access = (await folderAccess(user, upload.folder_id));
        requireValue(access.permission !== 'viewer' && access.folder.owner_id === upload.owner_id, 'Permission to upload into this folder has changed.', 403);
    }
    else
        requireValue(upload.owner_id === user.id, 'Invalid destination.', 403);
}
function publicState(upload: Upload) { return { id: upload.id, name: upload.name, size: upload.size, offset: upload.offset, hash: upload.expected_hash, folderId: upload.folder_id, fileId: upload.file_id, status: upload.status, expires: upload.expires, resultId: upload.result_id, chunkSize: 1048576 }; }
async function expireUploads() {
    const old = (await all<Upload>('SELECT * FROM upload_sessions WHERE expires<? AND lease<? LIMIT 50', Date.now(), Date.now()));
    for (const upload of old) {
        await unlink(uploadPath(upload.id)).catch(() => { });
        (await run('DELETE FROM upload_sessions WHERE id=? AND expires<?', upload.id, Date.now()));
    }
}
export async function uploadRequest(req: NextRequest, user: User, id?: string, command?: string) {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!id && req.method === 'GET')
        return json({ uploads: (await all<Upload>("SELECT * FROM upload_sessions WHERE user_id=? AND expires>? AND status<>'complete' ORDER BY expires DESC LIMIT 30", user.id, Date.now())).map(publicState) });
    if (!id && req.method === 'POST') {
        await expireUploads();
        const body = await req.json(), name = cleanName(body.name), size = Number(body.size);
        requireValue(Number.isSafeInteger(size) && size >= 0 && size <= (await maxUploadBytes()), 'Invalid file size or upload limit exceeded.', 413);
        requireValue(typeof body.hash === 'string' && /^[a-f0-9]{64}$/.test(body.hash), 'A SHA-256 content fingerprint is required.');
        const folderId = body.folderId ? positiveId(body.folderId) : null, fileId = body.fileId ? positiveId(body.fileId) : null;
        let owner = user.id;
        if (fileId) {
            const access = (await fileAccess(user, fileId));
            requireValue(access.permission !== 'viewer' && !access.row.deleted, 'You cannot upload a version of this file.', 403);
            owner = access.row.owner_id;
        }
        else if (folderId) {
            const access = (await folderAccess(user, folderId));
            requireValue(access.permission !== 'viewer', 'You have view-only folder access.', 403);
            owner = access.folder.owner_id;
        }
        const existing = (await one<Upload>("SELECT * FROM upload_sessions WHERE user_id=? AND name=? AND size=? AND expected_hash=? AND folder_id IS ? AND file_id IS ? AND expires>? AND status<>'complete'", user.id, name, size, body.hash, folderId, fileId, Date.now()));
        if (existing) {
            (await authorize(user, existing));
            return json(publicState(existing));
        }
        const uploadId = randomUUID();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const pool = await storagePool(owner);
        (await transaction(async () => {
            await lockStoragePool(pool);
            const reserved = (await one<{
                size: number;
            }>(`SELECT COALESCE(SUM(size),0) AS size FROM upload_sessions WHERE ${poolOwners('owner_id')} AND status<>'complete' AND expires>?`, owner, owner, Date.now()))!.size;
            requireValue((await usedStorage(owner)) + reserved + size <= (await quotaFor(owner)), 'Destination storage quota is reached, including pending uploads.', 413);
            requireValue((await all('SELECT id FROM upload_sessions WHERE user_id=? AND expires>?', user.id, Date.now())).length < 30, 'Cancel an old pending upload before adding more.', 429);
            (await run('INSERT INTO upload_sessions(id,user_id,owner_id,folder_id,file_id,name,size,expires,expected_hash) VALUES(?,?,?,?,?,?,?,?,?)', uploadId, user.id, owner, folderId, fileId, name, size, Date.now() + 86400000, body.hash));
        }));
        const file = await open(uploadPath(uploadId), 'wx', 0o600);
        await file.close();
        return json(publicState((await owned(user, uploadId))), 201);
    }
    requireValue(id, 'Upload ID required.');
    let upload = (await owned(user, id));
    (await authorize(user, upload));
    if (req.method === 'GET')
        return json(publicState(upload));
    if (req.method === 'DELETE') {
        requireValue(upload.lease < Date.now(), 'Upload is currently being saved. Try again shortly.', 409);
        (await run('DELETE FROM upload_sessions WHERE id=? AND user_id=?', id, user.id));
        await unlink(uploadPath(id)).catch(() => { });
        return json({ ok: true });
    }
    if (req.method === 'PUT' && !command) {
        const offset = Number(req.headers.get('x-upload-offset'));
        requireValue(Number.isSafeInteger(offset) && offset >= 0, 'Invalid upload offset.');
        const buffer = Buffer.from(await req.arrayBuffer());
        requireValue(buffer.length > 0 && buffer.length <= 1048576, 'Chunks must be 1 byte–1 MB.');
        if (offset < upload.offset)
            return json(publicState(upload));
        requireValue(offset === upload.offset && offset + buffer.length <= upload.size, 'Upload offset mismatch. Refresh the upload status.', 409);
        requireValue(upload.status === 'uploading' && upload.lease < Date.now(), 'Upload is busy. Retry shortly.', 409);
        const lock = (await run("UPDATE upload_sessions SET lease=? WHERE id=? AND offset=? AND status='uploading' AND lease<?", Date.now() + 60000, id, offset, Date.now()));
        requireValue(Number(lock.changes) === 1, 'Another chunk is being written. Retry shortly.', 409);
        try {
            const file = await open(uploadPath(id), 'r+');
            try {
                let written = 0;
                while (written < buffer.length) {
                    const result = await file.write(buffer, written, buffer.length - written, offset + written);
                    requireValue(result.bytesWritten > 0, 'Could not save the uploaded chunk.', 500);
                    written += result.bytesWritten;
                }
                await file.sync();
            }
            finally {
                await file.close();
            }
            (await run('UPDATE upload_sessions SET offset=?,lease=0,expires=? WHERE id=?', offset + buffer.length, Date.now() + 86400000, id));
        }
        catch (error) {
            (await run('UPDATE upload_sessions SET lease=0 WHERE id=?', id));
            throw error;
        }
        return json(publicState((await owned(user, id))));
    }
    if (req.method === 'POST' && command === 'complete') {
        if (upload.status === 'complete')
            return json(publicState(upload));
        requireValue(upload.offset === upload.size && upload.lease < Date.now(), 'Upload is incomplete or busy.', 409);
        const lock = (await run("UPDATE upload_sessions SET status='completing',lease=? WHERE id=? AND lease<? AND status<>'complete'", Date.now() + 240000, id, Date.now()));
        requireValue(Number(lock.changes) === 1, 'Upload completion is already in progress.', 409);
        try {
            const bytes = await readFile(uploadPath(id));
            requireValue(bytes.length === upload.size, 'Uploaded file size did not match.');
            requireValue(createHash('sha256').update(bytes).digest('hex') === upload.expected_hash, 'File checksum mismatch. Cancel and upload the original again.', 422);
            const prepared = await prepareUpload(new File([new Uint8Array(bytes)], upload.name));
            requireValue(prepared.hash === upload.expected_hash, 'File checksum mismatch. Cancel this session and upload the original again.', 422);
            const pool = await storagePool(upload.owner_id);
            const resultId = (await transaction(async () => {
                await lockStoragePool(pool);
                upload = (await owned(user, id!));
                (await authorize(user, upload));
                let result = upload.file_id;
                if (result)
                    (await addVersion(user, result, prepared));
                else
                    result = (await insertUpload(user, prepared, upload.folder_id));
                (await run("UPDATE upload_sessions SET status='complete',result_id=?,lease=0 WHERE id=?", result, id!));
                (await audit(user.id, 'upload.completed', upload.name));
                return result;
            }));
            await unlink(uploadPath(id)).catch(() => { });
            return json({ ...publicState((await owned(user, id))), resultId });
        }
        catch (error) {
            (await run("UPDATE upload_sessions SET status='uploading',lease=0 WHERE id=?", id));
            throw error;
        }
    }
    throw new HttpError(405, 'Method not allowed.');
}
