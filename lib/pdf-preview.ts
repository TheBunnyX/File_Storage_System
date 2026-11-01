import { workerEnvironment } from './worker-env';
import { putBlob, readBlob, localBlob } from './blobs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { blobDirectory, HttpError, rateLimit, requireValue } from './db';
import { fileAccess } from './storage';
import type { User } from './types';
import { requireCleanContent } from './antivirus';
type Rendered = {
    image: Uint8Array;
    total: number;
};
const cache = new Map<string, Rendered>();
const active = new Map<number, number>();
let activeTotal = 0;
export async function pdfPreview(user: User, id: number, page: number) {
    const { row } = (await fileAccess(user, id));
    (await requireCleanContent(row.hash));
    requireValue(row.type === 'PDF', 'Preview is available only for PDF files.');
    requireValue(row.bytes <= 12 * 1048576, 'In-app PDF rendering is limited to 12 MB. Download this file to view it.', 413);
    requireValue(Number.isSafeInteger(page) && page > 0 && page <= 10000, 'Invalid PDF page.');
    const key = `${row.hash}:${page}`;
    let result = cache.get(key);
    if (!result) {
        requireValue((active.get(user.id) || 0) < 2 && activeTotal < 8, 'PDF preview is busy. Please retry shortly.', 429);
        (await rateLimit(`pdf-preview:${user.id}`, 90, 60000));
        active.set(user.id, (active.get(user.id) || 0) + 1);
        activeTotal++;
        try {
            const localPath=await localBlob(row.hash);
        result = await new Promise<Rendered>((resolve, reject) => {
                const worker = fork(/* turbopackIgnore: true */ path.join(process.cwd(), 'lib', 'extract-worker.cjs'), [JSON.stringify({ path: localPath, extension: 'pdf', mode: 'preview', page })], { execArgv: ['--max-old-space-size=192'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', windowsHide: true, env: workerEnvironment() });
                let done = false;
                const finish = (error?: Error, value?: Rendered) => {
                    if (done)
                        return;
                    done = true;
                    clearTimeout(timer);
                    if (error)
                        reject(error);
                    else
                        resolve(value!);
                };
                const timer = setTimeout(() => { finish(new HttpError(422, 'PDF preview timed out. Download the original to view it.')); worker.kill(); }, 20000);
                worker.on('message', message => {
                    const value = message as unknown as Rendered & {
                        error?: string;
                    };
                    value.image ? finish(undefined, { image: new Uint8Array(value.image), total: value.total }) : finish(new HttpError(422, value.error || 'Could not render PDF page.'));
                });
                worker.on('error', () => finish(new HttpError(422, 'Could not render this PDF. Download the original.')));
                worker.on('exit', () => {
                    if (!done)
                        finish(new HttpError(422, 'PDF rendering was interrupted.'));
                });
            });
            if (cache.size >= 24)
                cache.delete(cache.keys().next().value!);
            cache.set(key, result);
        }
        finally {
            active.set(user.id, (active.get(user.id) || 1) - 1);
            activeTotal--;
        }
    }
    return new Response(new Uint8Array(result.image), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-PDF-Pages': String(result.total), 'X-Content-Type-Options': 'nosniff' } });
}
