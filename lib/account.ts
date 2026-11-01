import { demoAccounts } from './demo';
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { all, one, requireValue, run, rateLimit, transaction } from './db';
import { accountSummary, audit, base32, hashToken, passwordHash, passwordMatches, profileFor, seal, securityFor, totp, unseal, verifyFactor } from './security';
import { appSettings } from './settings';
import type { User } from './types';
export const accountActions = ['config', 'security', 'change-password', 'mfa-setup', 'mfa-enable', 'mfa-disable', 'revoke-sessions'];
export async function accountAction(req: NextRequest, action: string, user: User | null, setSession: (req: NextRequest, user: User) => Promise<NextResponse>) {
    const json = (value: unknown) => NextResponse.json(value, { headers: { 'Cache-Control': 'private, no-store' } });
    if (action === 'config' && req.method === 'GET')
        return json({ demoAccounts: await demoAccounts(), registration: (await appSettings()).registration });
    if (action === 'security' && req.method === 'GET') {
        requireValue(user, 'Please sign in.', 401);
        return json(await accountSummary(user));
    }
    requireValue(req.method === 'POST', 'Method not allowed.', 405);
    const body = await req.json();
    requireValue(body && typeof body === 'object', 'Invalid request.');
    requireValue(user, 'Please sign in.', 401);
    (await rateLimit(`security:${user.id}`, 15, 900000));
    requireValue(!(await profileFor(user.id)).is_demo, 'Account security cannot be changed for shared demo accounts.', 403);
    const account = (await one<{
        password: string;
    }>('SELECT password FROM users WHERE id=?', user.id))!;
    requireValue(await passwordMatches(body.currentPassword, account.password), 'Your current password is incorrect.', 401);
    if (action === 'change-password') {
        const password = await passwordHash(body.password);
        (await transaction(async () => { (await verifyFactor(user.id, body.code)); (await run('UPDATE users SET password=? WHERE id=?', password, user.id)); (await run('DELETE FROM sessions WHERE user_id=?', user.id)); (await run('DELETE FROM auth_tokens WHERE user_id=?', user.id)); (await audit(user.id, 'password.changed')); }));
        return (await setSession(req, user));
    }
    if (action === 'revoke-sessions') {
        (await transaction(async () => { (await verifyFactor(user.id, body.code)); (await run('DELETE FROM sessions WHERE user_id=?', user.id)); (await audit(user.id, 'sessions.revoked')); }));
        return (await setSession(req, user));
    }
    if (action === 'mfa-setup') {
        const security = (await securityFor(user.id));
        requireValue(!security.totp_secret, 'Two-factor authentication is already enabled.');
        const secret = base32(randomBytes(20));
        (await run('UPDATE account_security SET totp_pending=?,pending_expires=? WHERE user_id=?', seal(secret), Date.now() + 600000, user.id));
        const uri = `otpauth://totp/${encodeURIComponent(`NexaFile:${user.email}`)}?secret=${secret}&issuer=NexaFile&algorithm=SHA1&digits=6&period=30`;
        return json({ secret, qr: await QRCode.toDataURL(uri, { width: 220, margin: 2 }), expiresIn: 600 });
    }
    if (action === 'mfa-enable') {
        const security = (await securityFor(user.id));
        requireValue(!security.totp_secret && security.totp_pending && (security.pending_expires || 0) > Date.now(), 'Authenticator setup expired. Start again.');
        requireValue(typeof body.code === 'string' && /^\d{6}$/.test(body.code), 'Enter the 6-digit authenticator code.');
        const step = Math.floor(Date.now() / 30000), secret = unseal(security.totp_pending);
        const matched = [step - 1, step, step + 1].find(s => totp(secret, s) === body.code);
        requireValue(matched !== undefined, 'Authenticator code is incorrect.');
        const codes = Array.from({ length: 8 }, () => randomBytes(8).toString('hex').toUpperCase());
        (await transaction(async () => { (await run('UPDATE account_security SET totp_secret=totp_pending,totp_pending=NULL,pending_expires=NULL,totp_step=?,recovery=? WHERE user_id=?', matched, JSON.stringify(codes.map(hashToken)), user.id)); (await run('DELETE FROM sessions WHERE user_id=?', user.id)); (await audit(user.id, 'mfa.enabled')); }));
        const response = (await setSession(req, user));
        const result = await response.json();
        return new NextResponse(JSON.stringify({ ...result, recoveryCodes: codes }), { headers: response.headers });
    }
    if (action === 'mfa-disable') {
        (await transaction(async () => { (await verifyFactor(user.id, body.code)); (await run("UPDATE account_security SET totp_secret=NULL,totp_pending=NULL,pending_expires=NULL,recovery='[]',totp_step=-1 WHERE user_id=?", user.id)); (await run('DELETE FROM sessions WHERE user_id=?', user.id)); (await audit(user.id, 'mfa.disabled')); }));
        return (await setSession(req, user));
    }
    return json({ error: 'Unknown account action.' });
}
