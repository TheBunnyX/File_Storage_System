import { asyncFilter } from './db';
import type { NextRequest } from 'next/server';
import { all, one, positiveId, requireValue, run, transaction } from './db';
import { accountSummary, audit, roleFor, profileFor, canManageMember, demoFullAdmin, passwordHash, quotaFor, requireAdmin, securityFor } from './security';
import { personalStorage } from './storage';
import { appSettings, departmentName, departmentQuota, departmentQuotas, saveAppSettings, setDepartmentQuota } from './settings';
import { backupRoot, operationsStatus, runBackup, verifyBackup } from './operations';
import { scanConfiguration } from './antivirus';
import { removeSession } from './redis';
import path from 'node:path';
import type { User } from './types';
const roles = ['user', 'department_admin', 'super_admin'];
async function departments() {
    const counts = (await all<{ name: string; members: number }>("SELECT department AS name, COUNT(*) AS members FROM account_profiles WHERE department<>'' GROUP BY department"));
    const usage = (await all<{ name: string; used: number }>("SELECT p.department AS name, COALESCE(SUM(v.bytes),0) AS used FROM account_profiles p JOIN files f ON f.owner_id=p.user_id JOIN versions v ON v.file_id=f.id WHERE p.department<>'' GROUP BY p.department"));
    const names = [...new Set([...Object.keys(await departmentQuotas()), ...counts.map(row => row.name)])].sort();
    return Promise.all(names.map(async (name) => ({ name, members: Number(counts.find(row => row.name === name)?.members || 0), used: Number(usage.find(row => row.name === name)?.used || 0), quota: (await departmentQuota(name)) })));
}
export async function adminRequest(req: NextRequest, user: User, action?: string) {
    await requireAdmin(user);
    const actorProfile = (await profileFor(user.id)), systemAccess = (await roleFor(user)) === 'super_admin' && (!actorProfile.is_demo || demoFullAdmin());
    const members = (await asyncFilter((await all<User>('SELECT id,name,email FROM users ORDER BY id')), async (person) => person.id === user.id || (await canManageMember(user, person))));
    const allowed = new Set(members.map(person => person.id));
    const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
    if (req.method === 'GET') {
        const users = (await Promise.all(members.map(async (person) => { const security = (await securityFor(person.id)); const profile = (await profileFor(person.id)); return { ...person, role: (await roleFor(person)), department: profile.department, self: person.id === user.id, demo: !!profile.is_demo, canManage: (await canManageMember(user, person)), blocked: !!security.blocked, mfa: !!security.totp_secret, used: (await personalStorage(person.id)), quota: (await quotaFor(person.id)) }; })));
        const before = Number(req.nextUrl.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        const events = (await all('SELECT a.user_id,a.id,a.action,a.detail,a.created,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.id<? ORDER BY a.id DESC LIMIT 1000', before)).filter((event: any) => systemAccess || allowed.has(event.user_id)).slice(0, 100);
        const role = (await roleFor(user)), visible = new Set(users.map(person => person.department).filter(Boolean));
        // Demo and department admins only see departments of members they can already see.
        const departmentList = (await departments()).filter(d => systemAccess || (role === 'super_admin' ? visible.has(d.name) : d.name === actorProfile.department));
        return json({ users, events, departments: departmentList, settings: role === 'super_admin' ? (await appSettings()) : null, capabilities: { system: systemAccess, role, department: actorProfile.department, demo: !!actorProfile.is_demo }, system: systemAccess ? { ...(await operationsStatus()), antivirus: scanConfiguration() } : { backups: { enabled: false, intervalMinutes: 1440, retain: 7 }, lastBackup: null, disk: null, backupDirectory: '', antivirus: { configured: false, required: false } } });
    }
    requireValue(req.method === 'POST', 'Method not allowed.', 405);
    const body = await req.json();
    if (action === 'user') {
        const id = positiveId(body.id);
        const target = (await one<User>('SELECT id,name,email FROM users WHERE id=?', id));
        requireValue(target, 'Account not found.', 404);
        requireValue((await canManageMember(user, target)), 'You can manage only authorized members in your department.', 403);
        requireValue(body.blocked === undefined || typeof body.blocked === 'boolean' && (id !== user.id || !body.blocked), 'You cannot suspend your own account.');
        if (body.role !== undefined || body.department !== undefined)
            requireValue(systemAccess, 'Only a non-demo Super Admin can change roles and departments.', 403);
        if (body.role !== undefined)
            requireValue(roles.includes(body.role) && (id !== user.id || body.role === 'super_admin'), 'You cannot change your own role.');
        const department = body.department === undefined || body.department === '' ? body.department : departmentName(body.department);
        if (department)
            requireValue((await departments()).some(d => d.name === department), 'Create the department before assigning members.');
        if (body.quota !== undefined)
            requireValue(Number.isSafeInteger(body.quota) && body.quota >= 1048576 && body.quota <= 10995116277760, 'Invalid account quota.');
        (await transaction(async () => {
            const old = (await one<{
                quota_bytes: number | null;
            }>('SELECT * FROM user_limits WHERE user_id=?', id));
            (await run('INSERT INTO user_limits(user_id,quota_bytes) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET quota_bytes=excluded.quota_bytes', id, body.quota ?? old?.quota_bytes ?? null));
            if (body.role !== undefined)
                (await run('UPDATE account_security SET role=? WHERE user_id=?', body.role, id));
            if (department !== undefined)
                (await run('INSERT INTO account_profiles(user_id,department) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET department=excluded.department', id, department));
            if (body.blocked !== undefined) {
                (await run('UPDATE account_security SET blocked=? WHERE user_id=?', body.blocked ? 1 : 0, id));
                if (body.blocked)
                    (await run('DELETE FROM sessions WHERE user_id=?', id));
            }
            (await audit(user.id, 'admin.account-updated', String(id)));
        }));
        return json({ ok: true });
    }
    // Replaces emailed reset links: an authorized admin sets a new password and signs the member out everywhere.
    if (action === 'reset-password') {
        const id = positiveId(body.id);
        const target = (await one<User>('SELECT id,name,email FROM users WHERE id=?', id));
        requireValue(target, 'Account not found.', 404);
        requireValue(id !== user.id, 'Change your own password in Settings.');
        requireValue((await canManageMember(user, target)), 'You can manage only authorized members in your department.', 403);
        requireValue(!(await profileFor(id)).is_demo, 'Account security cannot be changed for shared demo accounts.', 403);
        requireValue(body.resetMfa === undefined || typeof body.resetMfa === 'boolean', 'Invalid request.');
        const password = await passwordHash(body.password);
        const sessions = (await all<{ token: string }>('SELECT token FROM sessions WHERE user_id=?', id));
        (await transaction(async () => {
            (await run('UPDATE users SET password=? WHERE id=?', password, id));
            if (body.resetMfa)
                (await run("UPDATE account_security SET totp_secret=NULL,totp_pending=NULL,pending_expires=NULL,recovery='[]',totp_step=-1 WHERE user_id=?", id));
            (await run('DELETE FROM sessions WHERE user_id=?', id));
            (await run('DELETE FROM auth_tokens WHERE user_id=?', id));
            (await audit(user.id, body.resetMfa ? 'admin.password-and-2fa-reset' : 'admin.password-reset', String(id)));
        }));
        for (const session of sessions)
            await removeSession(session.token);
        return json({ ok: true });
    }
    requireValue(systemAccess, 'Only a non-demo Super Admin can manage server operations.', 403);
    if (action === 'settings') {
        requireValue(body && typeof body === 'object', 'Invalid request.');
        (await saveAppSettings(body));
        (await audit(user.id, 'admin.settings-updated'));
        return json({ ok: true });
    }
    if (action === 'department') {
        const name = departmentName(body.name);
        if (body.remove === true) {
            requireValue(!(await one("SELECT 1 FROM account_profiles WHERE department=?", name)), 'Move every member out of this department before removing it.', 409);
            (await setDepartmentQuota(name, null));
            (await audit(user.id, 'admin.department-removed', name));
            return json({ ok: true });
        }
        (await setDepartmentQuota(name, body.quota));
        (await audit(user.id, 'admin.department-updated', name));
        return json({ ok: true });
    }
    if (action === 'backup-settings') {
        requireValue(typeof body.enabled === 'boolean' && Number.isSafeInteger(body.intervalMinutes) && body.intervalMinutes >= 15 && body.intervalMinutes <= 10080 && Number.isSafeInteger(body.retain) && body.retain >= 1 && body.retain <= 60, 'Choose 15–10,080 minutes and 1–60 retained backups.');
        (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('backup-settings',?)", JSON.stringify({ enabled: body.enabled, intervalMinutes: body.intervalMinutes, retain: body.retain })));
        (await audit(user.id, 'admin.backup-settings'));
        return json({ ok: true });
    }
    if (action === 'backup')
        return json(await runBackup(user.id));
    if (action === 'verify-backup') {
        requireValue(typeof body.name === 'string' && /^nexafile-[\dTZ-]+-[a-f0-9]{8}$/.test(body.name), 'Invalid backup name.');
        const target = path.resolve(backupRoot, body.name);
        const relative = path.relative(backupRoot, target);
        requireValue(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Invalid backup path.');
        const result = await verifyBackup(target);
        (await audit(user.id, 'backup.verified', body.name));
        return json(result);
    }
    return json({ error: 'Unknown admin action.' });
}
