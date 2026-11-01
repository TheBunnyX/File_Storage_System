import net from 'node:net';
import { HttpError, one, requireValue, run } from './db';
export function scanConfiguration() { return { configured: !!(process.env.CLAMAV_HOST || process.env.CLAMAV_SOCKET), required: process.env.ANTIVIRUS_REQUIRED === 'true' }; }
export async function scanBytes(buffer: Buffer) {
    const config = scanConfiguration();
    if (!config.configured) {
        requireValue(!config.required, 'Uploads are blocked until the required antivirus service is configured.', 503);
        return 'not-configured';
    }
    return new Promise<string>((resolve, reject) => {
        const socket = process.env.CLAMAV_SOCKET ? net.createConnection(process.env.CLAMAV_SOCKET) : net.createConnection({ host: process.env.CLAMAV_HOST!, port: Number(process.env.CLAMAV_PORT) || 3310 });
        let answer = '', settled = false;
        const finish = (error?: Error) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            error ? reject(error) : resolve('clean');
        };
        socket.setTimeout(45000, () => finish(new HttpError(503, 'Antivirus scan timed out. File was not accepted.')));
        socket.on('error', () => finish(new HttpError(503, 'Antivirus service is unavailable. File was not accepted.')));
        socket.on('data', chunk => {
            answer += chunk.toString();
            if (answer.length > 4096)
                return finish(new HttpError(503, 'Invalid antivirus response.'));
            if (answer.includes('\0') || answer.includes('\n')) {
                if (/ FOUND(?:\0|\n)/.test(answer))
                    finish(new HttpError(422, 'Malware was detected. This upload has been rejected.'));
                else if (/ OK(?:\0|\n)/.test(answer))
                    finish();
                else
                    finish(new HttpError(503, 'Antivirus could not scan this file. File was not accepted.'));
            }
        });
        socket.on('end', () => {
            if (!settled)
                finish(new HttpError(503, 'Antivirus connection closed before a result.'));
        });
        socket.on('connect', async () => {
            const write = (data: Buffer) => new Promise<void>((ok, fail) => socket.write(data, err => err ? fail(err) : ok()));
            try {
                await write(Buffer.from('zINSTREAM\0'));
                for (let at = 0; at < buffer.length; at += 65536) {
                    const chunk = buffer.subarray(at, at + 65536), size = Buffer.alloc(4);
                    size.writeUInt32BE(chunk.length);
                    await write(Buffer.concat([size, chunk]));
                }
                await write(Buffer.alloc(4));
            }
            catch {
                finish(new HttpError(503, 'Antivirus stream failed. File was not accepted.'));
            }
        });
    });
}
export async function recordScan(hash: string, status: string) {
    if (status === 'clean' || status === 'infected')
        (await run('INSERT OR REPLACE INTO blob_scans(hash,status,checked) VALUES(?,?,?)', hash, status, new Date().toISOString()));
    else
        (await run('INSERT OR IGNORE INTO blob_scans(hash,status,checked) VALUES(?,?,?)', hash, status, new Date().toISOString()));
}
export async function scanStatus(hash: string) {
    return (await one<{
        status: string;
        checked: string;
    }>('SELECT status,checked FROM blob_scans WHERE hash=?', hash)) || { status: 'not-scanned', checked: null };
}
export async function requireCleanContent(hash: string) { const scan = (await scanStatus(hash)); requireValue(scan.status !== 'infected', 'This file is blocked because malware was detected.', 403); requireValue(!scanConfiguration().required || scan.status === 'clean', 'This file must pass an antivirus scan before it can be opened.', 403); }
