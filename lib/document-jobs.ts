import { readBlob } from './blobs';
import { HttpError, rateLimit, requireValue } from './db';
import { fileAccess } from './storage';
import { audit } from './security';
import { recordScan, scanBytes } from './antivirus';
import type { User } from './types';
export async function rescanFile(user: User, id: number) {
    const { row, permission } = (await fileAccess(user, id));
    requireValue(permission === 'owner', 'Only the owner can request a rescan.', 403);
    (await rateLimit(`rescan:${user.id}`, 10, 3600000));
    try {
        const result = await scanBytes(await readBlob(row.hash));
        (await recordScan(row.hash, result));
        (await audit(user.id, 'file.scanned', `${id}:${result}`));
        return { status: result };
    }
    catch (error) {
        if (error instanceof HttpError && error.status === 422)
            (await recordScan(row.hash, 'infected'));
        throw error;
    }
}
