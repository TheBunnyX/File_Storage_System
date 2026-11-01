import { putBlob, readBlob, localBlob } from './blobs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { blobDirectory, positiveId, requireValue } from './db';
import { audit } from './security';
import { fileAccess } from './storage';
import { requireCleanContent } from './antivirus';
import type { User } from './types';
const maxFiles = 100, maxBytes = 200 * 1048576;
function uniqueName(name: string, used: Set<string>) {
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++)
        candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
}
export async function zipDownload(user: User, body: {
    ids?: unknown;
}) {
    requireValue(Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= maxFiles, `Select 1–${maxFiles} files.`);
    const ids = [...new Set(body.ids.map(positiveId))];
    const rows = (await Promise.all(ids.map(async (id) => (await fileAccess(user, id)).row)));
    requireValue(rows.every(row => !row.deleted), 'Restore files from Trash before downloading them.');
    requireValue(rows.reduce((n, row) => n + row.bytes, 0) <= maxBytes, `Select at most ${maxBytes / 1048576} MB per ZIP.`, 413);
    const zip = new AdmZip(), used = new Set<string>();
    for (const row of rows) {
        (await requireCleanContent(row.hash));
        zip.addFile(uniqueName(row.name, used), await readBlob(row.hash));
    }
    (await audit(user.id, 'file.zip', ids.join(',')));
    return new Response(new Uint8Array(zip.toBuffer()), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="nexafile.zip"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
