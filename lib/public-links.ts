import { putBlob, readBlob, localBlob } from './blobs';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { all, blobDirectory, HttpError, one, positiveId, requireValue, run, rateLimit } from './db';
import { audit, hashToken, passwordHash, passwordMatches, securityFor } from './security';
import { contentResponse, fileAccess, type FileRow } from './storage';
import { pdfPreview } from './pdf-preview';
import { requireCleanContent } from './antivirus';
import type { User } from './types';
type Link = {
    id: number;
    file_id: number;
    owner_id: number;
    password: string | null;
    expires: number;
    download: number;
    created: string;
};
export async function manageLinks(req: NextRequest, user: User, fileId: number) {
    const { permission, row } = (await fileAccess(user, fileId));
    requireValue(permission === 'owner' && !row.deleted, 'Only the owner can share an active file.', 403);
    const list = async () => (await all<Link>('SELECT id,file_id,owner_id,password,expires,download,created FROM public_links WHERE file_id=? ORDER BY id DESC', fileId)).map(link => ({ id: link.id, expires: link.expires, download: !!link.download, passwordProtected: !!link.password, created: link.created }));
    if (req.method === 'GET')
        return Response.json({ links: (await list()) }, { headers: { 'Cache-Control': 'no-store' } });
    if (req.method === 'POST') {
        const body = await req.json();
        const seconds = Number(body.expiresIn || 86400);
        requireValue(Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 2592000, 'Choose an expiry between one minute and 30 days.');
        requireValue(!body.password || typeof body.password === 'string' && body.password.length >= 10 && body.password.length <= 128, 'A link password must contain 10–128 characters.');
        requireValue(typeof body.download === 'boolean', 'Choose whether downloads are allowed.');
        const token = randomBytes(32).toString('hex');
        const password = body.password ? await passwordHash(body.password) : null;
        (await run('INSERT INTO public_links(token_hash,file_id,owner_id,password,expires,download,created) VALUES(?,?,?,?,?,?,?)', hashToken(token), fileId, user.id, password, Date.now() + seconds * 1000, body.download ? 1 : 0, new Date().toISOString()));
        (await audit(user.id, 'link.created', row.name));
        const origin = process.env.APP_URL || `${req.nextUrl.protocol}//${req.headers.get('host')}`;
        return Response.json({ url: `${origin}/share/${token}`, links: (await list()) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (req.method === 'DELETE') {
        const id = positiveId(req.nextUrl.searchParams.get('linkId'));
        (await run('DELETE FROM public_links WHERE id=? AND file_id=? AND owner_id=?', id, fileId, user.id));
        (await audit(user.id, 'link.revoked', row.name));
        return Response.json({ links: (await list()) });
    }
    throw new HttpError(405, 'Method not allowed.');
}
export async function publicLinkRequest(req: NextRequest, token: string, action?: string) {
    requireValue(/^[a-f0-9]{64}$/.test(token), 'This share link is invalid or expired.', 404);
    const link = (await one<Link>('SELECT * FROM public_links WHERE token_hash=?', hashToken(token)));
    requireValue(link && link.expires > Date.now() && !(await securityFor(link.owner_id)).blocked, 'This share link is invalid or expired.', 404);
    const owner = (await one<User>('SELECT id,name,email FROM users WHERE id=?', link.owner_id))!;
    const { row } = (await fileAccess(owner, link.file_id));
    requireValue(!row.deleted, 'This share link is no longer available.', 404);
    const cookieName = `nexafile_link_${link.id}`, cookie = req.cookies.get(cookieName)?.value;
    const unlocked = !link.password || cookie && (await one('SELECT 1 FROM link_sessions WHERE token_hash=? AND link_id=? AND expires>?', hashToken(cookie), link.id, Date.now()));
    if (req.method === 'POST' && !action) {
        (await rateLimit(`link-unlock:${link.id}`, 15, 900000));
        const body = await req.json();
        requireValue(!link.password || await passwordMatches(body.password, link.password), 'Incorrect link password.', 401);
        const session = randomBytes(32).toString('hex');
        (await run('DELETE FROM link_sessions WHERE expires<?', Date.now()));
        (await run('INSERT INTO link_sessions(token_hash,link_id,expires) VALUES(?,?,?)', hashToken(session), link.id, Math.min(link.expires, Date.now() + 3600000)));
        const res = NextResponse.json({ ok: true });
        res.cookies.set(cookieName, session, { httpOnly: true, sameSite: 'strict', secure: new URL(process.env.APP_URL || req.url).protocol === 'https:', maxAge: Math.min(3600, Math.floor((link.expires - Date.now()) / 1000)), path: '/' });
        return res;
    }
    requireValue(req.method === 'GET', 'Method not allowed.', 405);
    if (!action && !unlocked)
        return Response.json({ locked: true, name: row.name }, { headers: { 'Cache-Control': 'no-store' } });
    requireValue(unlocked, 'Unlock this share link first.', 401);
    (await requireCleanContent(row.hash));
    if (!action)
        return Response.json({ locked: false, name: row.name, type: row.type, bytes: row.bytes, download: !!link.download, expires: link.expires, text: ['Document', 'Spreadsheet', 'Presentation'].includes(row.type) ? row.text : '', extractionStatus: row.extraction_status }, { headers: { 'Cache-Control': 'no-store' } });
    if (action === 'download') {
        requireValue(link.download, 'Original downloads are disabled by the owner.', 403);
        (await audit(null, 'link.download', String(link.id)));
        const url = new URL(req.url);
        url.searchParams.set('download', '1');
        return (await contentResponse(owner, row.id, new Request(url, { headers: req.headers })));
    }
    if (action === 'preview') {
        (await rateLimit(`link-preview:${link.id}`, 120, 60000));
        if (row.type === 'PDF')
            return (await pdfPreview(owner, row.id, Number(req.nextUrl.searchParams.get('page') || 1)));
        if (row.type === 'Image') {
            const image = await sharp(await readBlob(row.hash), { limitInputPixels: 25000000 }).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
            return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
        requireValue(link.download, 'Media preview is unavailable when original downloads are disabled.', 403);
        return (await contentResponse(owner, row.id, req));
    }
    throw new HttpError(404, 'Not found.');
}
