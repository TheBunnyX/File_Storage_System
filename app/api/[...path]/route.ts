import { NextRequest, NextResponse } from 'next/server';
import { authenticate, currentUser, validateOrigin } from '@/lib/auth';
import { all, cleanName, HttpError, one, positiveId, rateLimit, requireValue, run, transaction } from '@/lib/db';
import { workspaceFiles, workspaceActivities, accessibleFiles, activity, addVersion, contentResponse, createFolder, detailsFor, fileAccess, folderAccess, foldersFor, insertUpload, prepareUpload, restoreVersion, serializeFile, sharesFor, updateFile,  lockStoragePool, personalStorage, storagePool, usedStorage } from '@/lib/storage';
import { FOLDER_COLORS, type Activity, type User } from '@/lib/types';
import { pdfPreview } from '@/lib/pdf-preview';
import { adminRequest } from '@/lib/admin';
import { accountSummary, preferencesFor, quotaFor } from '@/lib/security';
import { ensureBackupScheduler } from '@/lib/operations';
import { maxUploadBytes } from '@/lib/settings';
import { uploadRequest } from '@/lib/uploads';
import { manageLinks, publicLinkRequest } from '@/lib/public-links';
import { rescanFile } from '@/lib/document-jobs';
import { scanStatus } from '@/lib/antivirus';
import { zipDownload } from '@/lib/archive';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function boundedRequest(req: NextRequest) {
    if (['GET', 'HEAD'].includes(req.method) || !req.body)
        return req;
    const cap = req.headers.get('content-type')?.includes('multipart/form-data') ? Math.min(100 * 1048576, (await maxUploadBytes()) * 10 + 1048576) : 1048576;
    const length = Number(req.headers.get('content-length'));
    requireValue(!length || length <= cap, 'The request is too large. Upload fewer or smaller files.', 413);
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        total += value.length;
        if (total > cap) {
            await reader.cancel();
            throw new HttpError(413, 'The request is too large. Upload fewer or smaller files.');
        }
        chunks.push(value);
    }
    return new NextRequest(req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
}
async function handle(original: NextRequest, ctx: {
    params: Promise<{
        path: string[];
    }>;
}) {
    try {
        validateOrigin(original);
        const parts = (await ctx.params).path;
        // Authenticate before buffering an upload from an untrusted client.
        const user = ['auth', 'public'].includes(parts[0]) ? null : (await currentUser(original));
        if (user && original.method !== 'GET')
            (await rateLimit(`write:${user.id}`, parts[0] === 'uploads' ? 600 : 120, 60000));
        const req = await boundedRequest(original);
        if (parts[0] === 'auth')
            return await authenticate(req, parts[1]);
        if (parts[0] === 'public')
            return await publicLinkRequest(req, parts[1], parts[2]);
        requireValue(user, 'Please sign in.', 401);
        const [section, resource, command] = parts;
        (await ensureBackupScheduler());
        if (section === 'admin')
            return await adminRequest(req, user, resource);
        if (section === 'uploads')
            return await uploadRequest(req, user, resource, command);
        if (section === 'preferences') {
            if (req.method === 'GET')
                return json((await preferencesFor(user.id)));
            requireValue(req.method === 'PATCH', 'Method not allowed.', 405);
            const body = await req.json();
            const valid: Record<string, unknown> = {};
            if ('language' in body) {
                requireValue(['en', 'th'].includes(body.language), 'Invalid language.');
                valid.language = body.language;
            }
            if ('theme' in body) {
                requireValue(['light', 'dark', 'system'].includes(body.theme), 'Invalid theme.');
                valid.theme = body.theme;
            }
            if ('sort' in body) {
                requireValue(['modified-desc', 'modified-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc'].includes(body.sort), 'Invalid sort order.');
                valid.sort = body.sort;
            }
            for (const key of ['grid', 'ascending'])
                if (key in body) {
                    requireValue(typeof body[key] === 'boolean', 'Invalid preference.');
                    valid[key] = body[key];
                }
            const prefs = { ...(await preferencesFor(user.id)), ...valid };
            (await run('INSERT OR REPLACE INTO preferences(user_id,value) VALUES(?,?)', user.id, JSON.stringify(prefs)));
            return json(prefs);
        }
        if (section === 'workspace' && req.method === 'GET') {
            const [files,folders,used,personalUsed,quota,maxUpload,activities,preferences] = await Promise.all([
                workspaceFiles(user),foldersFor(user),usedStorage(user.id),personalStorage(user.id),quotaFor(user.id),maxUploadBytes(),workspaceActivities(user),preferencesFor(user.id)
            ]);
            return json({ user,files,folders,used,personalUsed,quota,maxUpload,activities,preferences });
        }
        if (section === 'search' && req.method === 'GET') {
            const query = (req.nextUrl.searchParams.get('q') || '').toLocaleLowerCase().slice(0, 500);
            const ids = (await accessibleFiles(user)).filter(f => `${f.name} ${f.tags} ${f.text}`.toLocaleLowerCase().includes(query)).map(f => f.id);
            return json({ ids });
        }
        if (section === 'users' && req.method === 'GET') {
            // Account picker for sharing: needs at least two characters and returns a handful of matches.
            const term = (req.nextUrl.searchParams.get('q') || '').trim().toLocaleLowerCase().replace(/[%_\\]/g, '').slice(0, 100);
            if (term.length < 2)
                return json({ users: [] });
            (await rateLimit(`users:${user.id}`, 60, 60000));
            const pattern = `%${term}%`;
            return json({ users: (await all<User>('SELECT id,name,email FROM users WHERE id<>? AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?) ORDER BY name LIMIT 8', user.id, pattern, pattern)) });
        }
        if (section === 'folders') {
            if (!resource && req.method === 'POST') {
                const body = await req.json();
                return json({ id: (await transaction(async () => (await createFolder(user, body.name, body.color)))) }, 201);
            }
            const id = positiveId(resource);
            const access = (await folderAccess(user, id));
            if (command === 'shares')
                return await sharing(req, user, 'folder', id, access.permission === 'owner');
            requireValue(access.permission === 'owner', 'Only the owner can manage this folder.', 403);
            if (req.method === 'PATCH') {
                const body = await req.json();
                requireValue(body.name !== undefined || body.color !== undefined, 'Nothing to update.');
                const name = body.name === undefined ? undefined : cleanName(body.name, 80);
                if (body.color !== undefined)
                    requireValue((FOLDER_COLORS as readonly string[]).includes(String(body.color)), 'Invalid folder color.');
                if (name !== undefined)
                    requireValue(!(await one('SELECT 1 FROM folders WHERE owner_id=? AND name=? AND id<>?', user.id, name, id)), 'A folder with this name already exists.', 409);
                (await transaction(async () => {
                    if (name !== undefined) { (await run('UPDATE folders SET name=? WHERE id=?', name, id)); (await activity(user, null, user.id, `Renamed folder “${access.folder.name}” to “${name}”`)); }
                    if (body.color !== undefined) { (await run('UPDATE folders SET color=? WHERE id=?', String(body.color), id)); (await activity(user, null, user.id, `Changed folder “${name ?? access.folder.name}” color to ${body.color}`)); }
                }));
                return json({ ok: true });
            }
            if (req.method === 'DELETE') {
                requireValue(!(await one('SELECT 1 FROM files WHERE folder_id=?', id)), 'Move all files out of this folder, including files in Trash, before deleting it.', 409);
                (await transaction(async () => { (await run("DELETE FROM shares WHERE kind='folder' AND resource_id=?", id)); (await run('DELETE FROM folders WHERE id=?', id)); (await activity(user, null, user.id, `Deleted empty folder “${access.folder.name}”`)); }));
                return json({ ok: true });
            }
        }
        if (section === 'files') {
            if (!resource && req.method === 'POST') {
                (await rateLimit(`upload:${user.id}`, 30, 60000));
                const form = await req.formData();
                const uploads = form.getAll('files');
                requireValue(uploads.length > 0 && uploads.length <= 10 && uploads.every(f => f instanceof File), 'Choose 1–10 files per upload.');
                const rawFolder = form.get('folderId');
                const folderId = rawFolder && rawFolder !== 'null' ? positiveId(rawFolder) : null;
                let owner = user.id;
                if (folderId) {
                    const target = (await folderAccess(user, folderId));
                    requireValue(target.permission !== 'viewer', 'You have view-only access to this folder.', 403);
                    owner = target.folder.owner_id;
                }
                const maxUpload = await maxUploadBytes();
                requireValue(uploads.every(f => (f as File).size <= maxUpload), `Each file must be smaller than ${Math.round(maxUpload / 1048576)} MB.`, 413);
                requireValue((await usedStorage(owner)) + uploads.reduce((n, f) => n + (f as File).size, 0) <= (await quotaFor(owner)), 'The destination workspace has reached its storage quota.', 413);
                const prepared: Awaited<ReturnType<typeof prepareUpload>>[] = [];
                for (const f of uploads as File[])
                    prepared.push(await prepareUpload(f));
                const pool = await storagePool(owner);
                const ids = (await transaction(async () => { await lockStoragePool(pool); return await Promise.all(prepared.map(async (data) => (await insertUpload(user, data, folderId)))); }));
                return json({ ids }, 201);
            }
            if (resource === 'zip' && req.method === 'POST')
                return await zipDownload(user, await req.json());
            if (resource === 'bulk' && req.method === 'PATCH') {
                const body = await req.json();
                requireValue(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 100, 'Select 1–100 files.');
                (await transaction(async () => {
                    for (const item of body.items) {
                        requireValue(item && typeof item === 'object', 'Invalid update.');
                        (await updateFile(user, positiveId(item.id), item.changes));
                    }
                }));
                return json({ ok: true });
            }
            const id = positiveId(resource);
            const access = (await fileAccess(user, id));
            if (command === 'links')
                return await manageLinks(req, user, id);
            if (command === 'scan' && req.method === 'POST')
                return json(await rescanFile(user, id));
            if (command === 'content' && req.method === 'GET')
                return await contentResponse(user, id, req);
            if (command === 'preview' && req.method === 'GET')
                return await pdfPreview(user, id, Number(req.nextUrl.searchParams.get('page') || 1));
            if (command === 'shares')
                return await sharing(req, user, 'file', id, access.permission === 'owner');
            if (command === 'versions') {
                if (req.method === 'POST') {
                    requireValue(access.permission !== 'viewer' && !access.row.deleted, 'You cannot upload a new version of this file.', 403);
                    const form = await req.formData();
                    const file = form.get('file');
                    requireValue(file instanceof File, 'Choose a replacement file.');
                    requireValue(file.size <= (await maxUploadBytes()) && (await usedStorage(access.row.owner_id)) + file.size <= (await quotaFor(access.row.owner_id)), 'The file exceeds the upload or storage limit.', 413);
                    const data = await prepareUpload(file);
                    const pool = await storagePool(access.row.owner_id);
                    (await transaction(async () => { await lockStoragePool(pool); return await addVersion(user, id, data); }));
                    return json({ ok: true }, 201);
                }
                if (req.method === 'PATCH') {
                    const body = await req.json();
                    (await transaction(async () => (await restoreVersion(user, id, positiveId(body.versionId)))));
                    return json({ ok: true });
                }
            }
            if (!command && req.method === 'GET')
                return json({ ...(await detailsFor(user, id)), scan: (await scanStatus(access.row.hash)) });
            if (!command && req.method === 'PATCH') {
                const body = await req.json();
                requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Invalid update.');
                (await transaction(async () => (await updateFile(user, id, body))));
                return json({ ok: true });
            }
            if (!command && req.method === 'DELETE') {
                requireValue(access.permission === 'owner' && !!access.row.deleted, 'Only the owner can permanently delete a file already in Trash.', 403);
                const body = await req.json();
                requireValue(body.confirmName === access.row.name, 'Type the exact file name to confirm permanent deletion.');
                (await transaction(async () => { (await run("DELETE FROM shares WHERE kind='file' AND resource_id=?", id)); (await run('DELETE FROM files WHERE id=?', id)); (await activity(user, null, user.id, `Permanently deleted “${access.row.name}” and its version history`)); }));
                return json({ ok: true });
            }
        }
        throw new HttpError(404, 'Endpoint not found.');
    }
    catch (error) {
        if (error instanceof HttpError)
            return json({ error: error.message }, error.status);
        if (error instanceof SyntaxError || error instanceof TypeError)
            return json({ error: 'Invalid request. Check the submitted fields and try again.' }, 400);
        console.error('NexaFile request failed:', error instanceof Error ? error.message : 'Unknown error');
        return json({ error: 'The request could not be completed. Please try again.' }, 500);
    }
}
async function sharing(req: NextRequest, user: User, kind: string, id: number, owner: boolean) {
    requireValue(owner, 'Only the owner can manage sharing.', 403);
    if (req.method === 'GET')
        return json({ shares: (await sharesFor(kind, id)) });
    if (req.method === 'POST') {
        const body = await req.json();
        requireValue(typeof body.email === 'string' && ['viewer', 'editor'].includes(body.permission), 'Enter an email and choose a permission.');
        const person = (await one<User>('SELECT id,name,email FROM users WHERE email=?', body.email.trim().toLowerCase()));
        requireValue(person, 'This person must create a NexaFile account before you can share with them.', 404);
        requireValue(person.id !== user.id, 'You already own this item.');
        (await transaction(async () => { (await run('INSERT INTO shares(kind,resource_id,user_id,permission) VALUES(?,?,?,?) ON CONFLICT(kind,resource_id,user_id) DO UPDATE SET permission=excluded.permission', kind, id, person.id, body.permission)); (await activity(user, kind === 'file' ? id : null, user.id, `Shared ${kind} with ${person.email} (${body.permission})`)); }));
        return json({ shares: (await sharesFor(kind, id)) });
    }
    if (req.method === 'DELETE') {
        const shareId = positiveId(req.nextUrl.searchParams.get('shareId'));
        requireValue((await one('SELECT 1 FROM shares WHERE id=? AND kind=? AND resource_id=?', shareId, kind, id)), 'Share not found.', 404);
        (await transaction(async () => { (await run('DELETE FROM shares WHERE id=?', shareId)); (await activity(user, kind === 'file' ? id : null, user.id, `Revoked ${kind} access`)); }));
        return json({ shares: (await sharesFor(kind, id)) });
    }
    throw new HttpError(405, 'Method not allowed.');
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as PUT };
