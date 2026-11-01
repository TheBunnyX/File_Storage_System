import { mysqlEnabled } from './mysql';
import { createHash, createHmac, randomBytes, scrypt as derive, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { all, dataDirectory, db, one, requireValue, run, transaction } from './db';
import type { User } from './types';
import { appSettings, departmentQuota } from './settings';
const scrypt = promisify(derive);
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export async function audit(userId: number | null, action: string, detail = '') { (await run('INSERT INTO audit(user_id,action,detail,created) VALUES(?,?,?,?)', userId, action, detail.slice(0, 500), new Date().toISOString())); }
export async function passwordHash(value: unknown) {
    requireValue(typeof value === 'string' && value.length >= 10 && value.length <= 128, 'Use a password of 10–128 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(value, salt, 64) as Buffer;
    return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(value: unknown, hash: string) {
    if (typeof value !== 'string' || value.length > 128)
        return false;
    const [salt, expected] = hash.split(':');
    if (!salt || !expected || !/^[a-f0-9]{128}$/.test(expected))
        return false;
    const key = await scrypt(value, salt, 64) as Buffer;
    return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
function encryptionKey() {
    if(mysqlEnabled())mkdirSync(dataDirectory,{recursive:true,mode:0o700});else db();
    const file = path.join(dataDirectory, 'server.key');
    if (!existsSync(file)) {
        try {
            writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
    }
    const key = readFileSync(file);
    requireValue(key.length === 32, 'Invalid server encryption key.', 500);
    return key;
}
export function seal(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.'); }
export function unseal(value: string) { const [iv, tag, encrypted] = value.split('.').map(s => Buffer.from(s, 'base64url')); const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8'); }
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(data: Buffer) {
    let bits = '', value = '';
    for (const byte of data)
        bits += byte.toString(2).padStart(8, '0');
    for (let i = 0; i < bits.length; i += 5)
        value += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return value;
}
function unbase32(secret: string) {
    let bits = '';
    for (const char of secret) {
        const n = alphabet.indexOf(char);
        requireValue(n >= 0, 'Invalid authenticator secret.', 500);
        bits += n.toString(2).padStart(5, '0');
    }
    return Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2)));
}
export function totp(secret: string, step = Math.floor(Date.now() / 30000), digits = 6) { const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', unbase32(secret)).update(counter).digest(); const offset = h[h.length - 1] & 15; return String((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0'); }
export type AccountSecurity = {
    user_id: number;
    email_verified: number;
    role: string;
    blocked: number;
    totp_secret: string | null;
    totp_pending: string | null;
    pending_expires: number | null;
    totp_step: number;
    recovery: string;
};
export async function securityFor(id: number) {
    const existing=await one<AccountSecurity>('SELECT * FROM account_security WHERE user_id=?',id);
    if(existing)return existing;
    await run('INSERT OR IGNORE INTO account_security(user_id) VALUES(?)',id);
    return (await one<AccountSecurity>('SELECT * FROM account_security WHERE user_id=?',id))!;
}
export async function verifyFactor(userId: number, code: unknown) {
    const row = (await securityFor(userId));
    if (!row.totp_secret)
        return;
    requireValue(typeof code === 'string' && code.length <= 40, 'Enter your authenticator or recovery code.', 401);
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    const recovery: string[] = JSON.parse(row.recovery);
    const index = recovery.indexOf(hashToken(normalized));
    if (index >= 0) {
        (await transaction(async () => { const fresh = (await securityFor(userId)); const codes: string[] = JSON.parse(fresh.recovery); requireValue(codes.includes(hashToken(normalized)), 'Recovery code has already been used.', 401); (await run('UPDATE account_security SET recovery=? WHERE user_id=?', JSON.stringify(codes.filter(c => c !== hashToken(normalized))), userId)); }));
        (await audit(userId, 'mfa.recovery-used'));
        return;
    }
    requireValue(/^\d{6}$/.test(normalized), 'Invalid authenticator or recovery code.', 401);
    const step = Math.floor(Date.now() / 30000);
    const secret = unseal(row.totp_secret);
    const matched = [step - 1, step, step + 1].find(s => s > row.totp_step && timingSafeEqual(Buffer.from(totp(secret, s)), Buffer.from(normalized)));
    requireValue(matched !== undefined, 'Invalid or already used authenticator code. Wait for a new code.', 401);
    const result = (await run('UPDATE account_security SET totp_step=? WHERE user_id=? AND totp_step<?', matched, userId, matched));
    requireValue(Number(result.changes) === 1, 'Authenticator code has already been used.', 401);
}
export async function profileFor(id: number) {
    return (await one<{
        department: string;
        is_demo: number;
    }>('SELECT department,is_demo FROM account_profiles WHERE user_id=?', id)) || { department: '', is_demo: 0 };
}
export async function roleFor(user: User, security?: AccountSecurity) {
    const stored = (security || await securityFor(user.id)).role;
    if (stored === 'admin' || stored === 'super_admin' || (process.env.NEXAFILE_ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).includes(user.email.toLowerCase()))
        return 'super_admin';
    return stored === 'department_admin' ? 'department_admin' : 'user';
}
// Opt-in for private test machines: the shared demo Super Admin gets full Super Admin rights.
export const demoFullAdmin = () => process.env.NEXAFILE_DEMO === 'true' && process.env.NEXAFILE_DEMO_FULL_ADMIN === 'true';
export async function isAdmin(user: User) { return (await roleFor(user)) !== 'user'; }
export async function canManageMember(actor: User, member: User) {
    const role = (await roleFor(actor)), a = (await profileFor(actor.id)), b = (await profileFor(member.id));
    if (role === 'user' || (a.is_demo && !b.is_demo && !(role === 'super_admin' && demoFullAdmin())))
        return false;
    if (role === 'super_admin')
        return true;
    return !!a.department && a.department === b.department && (await roleFor(member)) === 'user';
}
export async function requireAdmin(user: User) { requireValue((await isAdmin(user)), 'Administrator access is required.', 403); }
// Department members share their department's storage; others keep a personal quota.
export async function quotaFor(id: number) {
    const { department } = (await profileFor(id));
    if (department)
        return departmentQuota(department);
    return (await one<{
        quota_bytes: number | null;
    }>('SELECT quota_bytes FROM user_limits WHERE user_id=?', id))?.quota_bytes ?? (await appSettings()).defaultQuotaMb * 1048576;
}
export async function preferencesFor(id: number) {
    return JSON.parse((await one<{
        value: string;
    }>('SELECT value FROM preferences WHERE user_id=?', id))?.value || '{}');
}
export async function accountSummary(user: User) {
    const s = (await securityFor(user.id));
    return { mfa: !!s.totp_secret, recoveryRemaining: JSON.parse(s.recovery).length, role: (await roleFor(user)), sessions: (await all<{
            expires: number;
        }>('SELECT expires FROM sessions WHERE user_id=? ORDER BY expires DESC', user.id)) };
}
