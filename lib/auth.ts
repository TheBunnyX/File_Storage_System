import { cacheSession, sessionIsActive, removeSession } from './redis';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { one, run, requireValue, HttpError, rateLimit, transaction, cleanName } from './db';
import type { User } from './types';
import { audit, roleFor, profileFor, securityFor, verifyFactor } from './security';
import { accountAction, accountActions } from './account';
import { appSettings } from './settings';
const scrypt = promisify(scryptCallback);
const COOKIE = 'nexafile_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export async function currentUser(req: NextRequest) {
    const token = req.cookies.get(COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token))
        throw new HttpError(401, 'Please sign in to continue.');
    const user = (await one<User>('SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?', digest(token), Date.now()));
    if (!user)
        throw new HttpError(401, 'Your session has expired. Please sign in again.');
    requireValue(await sessionIsActive(digest(token),user.id), 'Your session has expired. Please sign in again.',401);
    const security = (await securityFor(user.id));
    const profile = await profileFor(user.id);
    requireValue(!profile.is_demo || process.env.NEXAFILE_DEMO === 'true', 'Demo accounts are disabled.', 401);
    requireValue(!security.blocked, 'This account is suspended. Contact the administrator.', 401);
    return { ...user, role: (await roleFor(user, security)), department: profile.department, demo: !!profile.is_demo };
}
export function validateOrigin(req: NextRequest) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        return;
    const origin = req.headers.get('origin');
    // Next's internal request origin can use its listener hostname rather than the
    // address in the browser (for example localhost vs 127.0.0.1).
    const host = req.headers.get('host') || req.nextUrl.host;
    requireValue(!/[\s/@?#\\]/.test(host), 'Invalid request host.', 400);
    const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(`${req.nextUrl.protocol}//${host}`).origin;
    requireValue(origin === expected, 'Request origin is not allowed.', 403);
    requireValue(req.headers.get('sec-fetch-site') !== 'cross-site', 'Cross-site requests are not allowed.', 403);
}
async function setSession(req: NextRequest, user: User) {
    const token = randomBytes(32).toString('hex');
    (await run('DELETE FROM sessions WHERE expires < ?', Date.now()));
    const previous = req.cookies.get(COOKIE)?.value;
    if (previous)
        (await run('DELETE FROM sessions WHERE token=?', digest(previous)));
    (await run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', digest(token), user.id, Date.now() + lifetime));
    await cacheSession(digest(token),user.id,Date.now()+lifetime);
    if(previous)await removeSession(digest(previous));
    const res = NextResponse.json({ user });
    res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: new URL(process.env.APP_URL || req.url).protocol === 'https:', path: '/', maxAge: lifetime / 1000 });
    return res;
}
export async function authenticate(req: NextRequest, action: string) {
    if (accountActions.includes(action))
        return (await accountAction(req, action, action === 'config' ? null : (await currentUser(req)), setSession));
    if (action === 'me' && req.method === 'GET')
        return NextResponse.json({ user: (await currentUser(req)) });
    requireValue(req.method === 'POST', 'Method not allowed.', 405);
    if (action === 'logout') {
        const token = req.cookies.get(COOKIE)?.value;
        if (token)
            (await run('DELETE FROM sessions WHERE token=?', digest(token)));
        if(token)await removeSession(digest(token));
        const res = NextResponse.json({ ok: true });
        res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
        return res;
    }
    requireValue(action === 'login' || action === 'register', 'Not found.', 404);
    // Shared deployment limits still work without trusting spoofable forwarded IP headers.
    (await rateLimit(`auth-global`, 120, 60000));
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    requireValue(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
    (await rateLimit(`auth:${digest(email)}`, 10, 15 * 60000));
    requireValue(typeof body.password === 'string' && body.password.length >= 10 && body.password.length <= 128, 'Use a password of 10–128 characters.');
    const found = (await one<User & {
        password: string;
    }>('SELECT id,name,email,password FROM users WHERE email=?', email));
    if (action === 'register') {
        requireValue((await appSettings()).registration, 'Registration is disabled. Contact the workspace administrator.', 403);
        requireValue(!found, 'An account already exists with this email.', 409);
        const name = cleanName(body.name, 80);
        const salt = randomBytes(16).toString('hex');
        const key = await scrypt(body.password, salt, 64) as Buffer;
        const user = (await transaction(async () => {
            requireValue(!(await one('SELECT 1 FROM users WHERE email=?', email)), 'An account already exists with this email.', 409);
            const id = Number((await run('INSERT INTO users(name,email,password,created) VALUES(?,?,?,?)', name, email, `${salt}:${key.toString('hex')}`, new Date().toISOString())).lastInsertRowid);
            (await securityFor(id));
            (await audit(id, 'account.created'));
            for (const [folder, color] of [['Work Projects', 'blue'], ['Personal', 'purple'], ['Research', 'green'], ['Design Assets', 'yellow'], ['Travel', 'pink']])
                (await run('INSERT INTO folders(owner_id,name,color,created) VALUES(?,?,?,?)', id, folder, color, new Date().toISOString()));
            return { id, name, email };
        }));
        return (await setSession(req, user));
    }
    // Run the password derivation even for an unknown email.
    const [salt, expected] = (found?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = await scrypt(body.password, salt, 64) as Buffer;
    requireValue(found && timingSafeEqual(actual, Buffer.from(expected, 'hex')), 'Email or password is incorrect.', 401);
    requireValue(!(await profileFor(found.id)).is_demo || process.env.NEXAFILE_DEMO === 'true', 'Demo accounts are disabled.', 401);
    const security = (await securityFor(found.id));
    requireValue(!security.blocked, 'This account is suspended. Contact the administrator.', 403);
    if (security.totp_secret && !body.code)
        return NextResponse.json({ mfaRequired: true }, { headers: { 'Cache-Control': 'no-store' } });
    (await verifyFactor(found.id, body.code));
    (await audit(found.id, 'account.login'));
    return (await setSession(req, { id: found.id, name: found.name, email: found.email }));
}
