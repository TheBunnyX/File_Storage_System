'use client';
import { useEffect, useState } from 'react';
import { Building2, Database, FileClock, HardDrive, LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { adminSections, sectionIcons } from './admin-sections';
import { useLocale } from './preferences';
import { formatBytes } from '@/lib/types';
type Member = {
    department?: string;
    canManage?: boolean;
    self?: boolean;
    demo?: boolean;
    id: number;
    name: string;
    email: string;
    role: string;
    blocked: boolean;
    mfa: boolean;
    used: number;
    quota: number;
};
type Department = {
    name: string;
    members: number;
    used: number;
    quota: number;
};
type Settings = {
    registration: boolean;
    defaultQuotaMb: number;
    maxUploadMb: number;
    trashRetentionDays: number;
};
const GB = 1024 ** 3;
type AdminData = {
    departments: Department[];
    settings: Settings | null;
    capabilities?: {
        system: boolean;
        role: string;
        department: string;
        demo: boolean;
    };
    users: Member[];
    events: {
        id: number;
        action: string;
        detail: string;
        created: string;
        actor: string | null;
    }[];
    system: {
        backups: {
            enabled: boolean;
            intervalMinutes: number;
            retain: number;
        };
        lastBackup: null | {
            status: string;
            name?: string;
            message?: string;
            completed?: string;
            blobs?: number;
            verified?: boolean;
        };
        disk: null | {
            free: number;
            total: number;
        };
        backupDirectory: string;
        antivirus: {
            configured: boolean;
            required: boolean;
        };
    };
};
function tabsFor(capabilities?: AdminData['capabilities']) {
    return !capabilities || capabilities.system ? adminSections('super_admin') : adminSections(capabilities.role);
}
// Rendered inside the workspace, whose sidebar chooses the section.
export function AdminPanel({ section }: { section: string }) {
    const { t, language } = useLocale();
    const [data, setData] = useState<AdminData | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState<Member | null>(null), [backupEnabled, setBackupEnabled] = useState(true), [interval, setInterval] = useState('1440'), [retain, setRetain] = useState('7');
    const tab = !data || tabsFor(data.capabilities).includes(section) ? section : 'Members';
    async function load() { const res = await fetch('/api/admin', { cache: 'no-store' }); const body = await res.json(); if (!res.ok)
        throw new Error(body.error); setData(body); setBackupEnabled(body.system.backups.enabled); setInterval(String(body.system.backups.intervalMinutes)); setRetain(String(body.system.backups.retain)); }
    useEffect(() => { void load().catch(err => setError(err.message)); }, []);
    async function action(path: string, body: unknown) { setBusy(true); setError(''); setMessage(''); try {
        const res = await fetch(`/api/admin/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const value = await res.json();
        if (!res.ok)
            throw new Error(value.error);
        setMessage(path === 'backup' ? 'Backup completed and verified.' : path === 'verify-backup' ? 'Backup database and all file hashes verified.' : path === 'reset-password' ? 'Password reset. The member has been signed out of all devices.' : 'Changes saved.');
        setEditing(null);
        await load();
    }
    catch (err) {
        setError((err as Error).message);
    }
    finally {
        setBusy(false);
    } }
    const refreshButton = <button className="admin-refresh" disabled={busy} aria-label={t("Refresh admin data")} onClick={() => void load().catch(err => setError(err.message))}><RefreshCw size={15}/>{t('Refresh')}</button>;
    const content = <div className="admin-content">{data?.capabilities?.demo && !data.capabilities.system && <div className="info-note">{t('Demo mode: only demo accounts can be managed. Server operations are disabled.')}</div>}{error && <div className="form-error" role="alert">{t(error)}</div>}{message && <div className="success-note" role="status">{t(message)}</div>}{!data && !error && <LoaderCircle className="spin"/>}{data && <>{tab === 'Overview & services' && <>{!data.capabilities?.system && <div className="info-note">{t('Server details are hidden in demo mode.')}</div>}<div className="admin-stats"><div><Users size={22}/><strong>{data.users.length}</strong><span>{t('Members')}</span></div><div><HardDrive size={22}/><strong>{formatBytes(data.users.reduce((n, u) => n + u.used, 0))}</strong><span>{t("Stored data (including versions)")}</span></div><div><Database size={22}/><strong>{t(data.system.disk ? formatBytes(data.system.disk.free) : 'Unavailable')}</strong><span>{t("Free disk space")}</span></div><div><FileClock size={22}/><strong>{t(data.system.lastBackup?.status || 'Not yet run')}</strong><span>{t("Latest backup")}</span></div></div><section className="admin-card"><h2>{t("Service status")}</h2><div className="service-grid">{[['Antivirus', data.system.antivirus.configured, data.system.antivirus.configured ? t('ClamAV: {requirement}. Every upload is scanned and rejected if the scanner is unavailable.',{requirement:t(data.system.antivirus.required?'Required':'Optional')}) : t('ClamAV: {requirement}. Set CLAMAV_HOST/PORT or CLAMAV_SOCKET; scans fail closed when configured.',{requirement:t(data.system.antivirus.required?'Required':'Optional')})], ['Automatic backups', data.system.backups.enabled, 'Runs while the application server is online. Configure an external backup destination for disaster recovery.']].map(([name, ready, help]) => <div key={String(name)}><strong>{t(String(name))}<span className={`service-dot ${ready ? 'ready' : ''}`}/></strong><p>{t(String(help))}</p><small>{t(ready ? 'Ready / enabled' : 'Not configured / disabled')}</small></div>)}</div></section></>}
    {tab === 'Members' && <section className="admin-card"><h2 className="admin-section-title">{t('Members')}</h2><div className="admin-table-wrap"><table><thead><tr><th>{t('Name')}</th><th>{t("Role / security")}</th><th>{t('Storage')}</th><th /></tr></thead><tbody>{data.users.map(person => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.email}</small></td><td>{t(person.role)}{person.department && <small>{person.department}</small>}{person.blocked ? ' · '+t('Suspended') : ''}<small>{t(person.mfa ? '2FA enabled' : 'No 2FA')}</small></td><td>{formatBytes(person.used)}{person.department ? <small>{t('Shared department storage')}</small> : <>{t("/")}{formatBytes(person.quota)}</>}</td><td><button className="text-button" disabled={person.canManage === false} onClick={() => setEditing(person)}>{t('Edit')}</button></td></tr>)}</tbody></table></div>{editing && <form key={editing.id} className="dialog-form member-editor" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); const system = data.capabilities?.system, department = system ? String(form.get('department')) : editing.department; void action('user', { id: editing.id, blocked: form.get('blocked') === 'on', ...(department ? {} : { quota: Math.round(Number(form.get('quota')) * 1048576) }), ...(system ? { role: form.get('role'), department } : {}) }); }}><h3>{editing.name}</h3><div className="settings-columns">{data.capabilities?.system && <><label>{t('Role')}<select name="role" defaultValue={editing.role}>{['user', 'department_admin', 'super_admin'].map(role => <option key={role} value={role}>{t(role)}</option>)}</select></label><label>{t('Department')}<select name="department" defaultValue={editing.department || ''} onChange={e => setEditing({ ...editing, department: e.target.value })}><option value="">{t('No department')}</option>{data.departments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}</select></label></>}{!editing.department && <label>{t('Storage quota (MB)')}<input type="number" name="quota" min="1" defaultValue={Math.round(editing.quota / 1048576)} required/></label>}</div><label className="checkbox-label"><input type="checkbox" name="blocked" defaultChecked={editing.blocked}/>{t('Suspend account')}</label><button className="primary-button" disabled={busy}>{t('Save changes')}</button><button type="button" className="text-button" onClick={() => setEditing(null)}>{t('Cancel')}</button></form>}{editing && !editing.self && !editing.demo && editing.canManage !== false && <form key={`reset-${editing.id}`} className="dialog-form member-editor" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); if (form.get('password') !== form.get('confirm')) {
        setError('The new passwords do not match.');
        return;
    } void action('reset-password', { id: editing.id, password: form.get('password'), resetMfa: form.get('resetMfa') === 'on' }); }}><h3>{t('Reset password')}</h3><p className="setting-description">{t('Set a new password for {name}. They will be signed out of all devices. Share it with them privately.', { name: editing.name })}</p><div className="settings-columns"><label>{t('New password')}<input type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={128}/></label><label>{t('Confirm password')}<input type="password" name="confirm" autoComplete="new-password" required minLength={10} maxLength={128}/></label></div>{editing.mfa && <label className="checkbox-label"><input type="checkbox" name="resetMfa"/>{t('Also turn off two-factor authentication')}</label>}<button className="primary-button" disabled={busy}>{t('Reset password')}</button></form>}</section>}
    {tab === 'Departments' && <section className="admin-card"><h2 className="admin-section-title">{t('Departments')}</h2><p className="setting-description">{t('Everyone in a department shares its storage. Uploads stop when the department storage is full.')}</p>{data.departments.length === 0 && <p className="setting-description">{t('No departments yet.')}</p>}{data.departments.length > 0 && <div className="admin-table-wrap"><table><thead><tr><th>{t('Department')}</th><th>{t('Members')}</th><th>{t('Storage')}</th><th /></tr></thead><tbody>{data.departments.map(d => <tr key={d.name}><td><strong><Building2 size={15}/> {d.name}</strong></td><td>{d.members}</td><td>{formatBytes(d.used)}{t("/")}{formatBytes(d.quota)}<div className="progress"><i style={{ width: `${Math.min(100, d.used / d.quota * 100)}%` }}/></div></td><td>{data.capabilities?.system && <form className="inline-form" onSubmit={e => { e.preventDefault(); void action('department', { name: d.name, quota: Math.round(Number(new FormData(e.currentTarget).get('quota')) * GB) }); }}><input type="number" name="quota" min="0.01" step="0.01" aria-label={t('Department storage (GB)')} defaultValue={+(d.quota / GB).toFixed(2)} required/><button className="text-button" disabled={busy}>{t('Save')}</button>{d.members === 0 && <button type="button" className="text-button" disabled={busy} onClick={() => void action('department', { name: d.name, remove: true })}>{t('Remove')}</button>}</form>}</td></tr>)}</tbody></table></div>}{data.capabilities?.system && <form className="dialog-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void action('department', { name: form.get('name'), quota: Math.round(Number(form.get('quota')) * GB) }); e.currentTarget.reset(); }}><h3>{t('Add department')}</h3><div className="settings-columns"><label>{t('Department name')}<input name="name" maxLength={80} required/></label><label>{t('Department storage (GB)')}<input type="number" name="quota" min="0.01" step="0.01" defaultValue={10} required/></label></div><button className="primary-button" disabled={busy}>{t('Add department')}</button></form>}{!data.capabilities?.system && <div className="info-note">{t('Only a non-demo Super Admin can change department storage.')}</div>}</section>}
    {tab === 'System settings' && data.settings && <section className="admin-card"><h2 className="admin-section-title">{t('System settings')}</h2><p className="setting-description">{t('Changes apply immediately. Values in .env are used until settings are saved here.')}</p><form className="dialog-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void action('settings', { registration: form.get('registration') === 'on', defaultQuotaMb: Number(form.get('defaultQuotaMb')), maxUploadMb: Number(form.get('maxUploadMb')), trashRetentionDays: Number(form.get('trashRetentionDays')) }); }}><fieldset disabled={!data.capabilities?.system || busy}><label className="checkbox-label"><input type="checkbox" name="registration" defaultChecked={data.settings.registration}/>{t('Allow new account registration')}</label><div className="settings-columns"><label>{t('Default quota for members without a department (MB)')}<input type="number" name="defaultQuotaMb" min="1" defaultValue={data.settings.defaultQuotaMb} required/></label><label>{t('Maximum upload size (MB)')}<input type="number" name="maxUploadMb" min="1" max="100" defaultValue={data.settings.maxUploadMb} required/></label><label>{t('Trash retention (days, 0 keeps files)')}<input type="number" name="trashRetentionDays" min="0" max="3650" defaultValue={data.settings.trashRetentionDays} required/></label></div><button className="primary-button">{t('Save changes')}</button></fieldset></form>{!data.capabilities?.system && <div className="info-note">{t('Only a non-demo Super Admin can change system settings.')}</div>}</section>}
    {tab === 'Backups' && <section className="admin-card"><h2 className="admin-section-title">{t('Backups')}</h2>{data.system.backupDirectory && <p className="setting-description">{t("Destination:")}{data.system.backupDirectory}</p>}<p className="setting-description">{data.system.lastBackup ? <><strong>{t(data.system.lastBackup.status)}</strong>{data.system.lastBackup.completed&&<> · {new Date(data.system.lastBackup.completed).toLocaleString(language==='th'?'th-TH':'en-US')}</>}{data.system.lastBackup.name&&<><br/>{data.system.lastBackup.name}</>}{data.system.lastBackup.message&&<><br/>{t(data.system.lastBackup.message)}</>}</> : t('No backup has run yet.')}</p><fieldset disabled={!data.capabilities?.system || busy}><div className="admin-actions"><button className="primary-button" onClick={() => void action('backup', {})}>{busy ? t('Working…') : t('Run backup now')}</button>{data.system.lastBackup?.name && <button className="secondary-button" disabled={busy} onClick={() => void action('verify-backup', { name: data.system.lastBackup!.name })}>{t('Verify last backup')}</button>}</div><form className="dialog-form" onSubmit={e => { e.preventDefault(); void action('backup-settings', { enabled: backupEnabled, intervalMinutes: Number(interval), retain: Number(retain) }); }}><label className="checkbox-label"><input type="checkbox" checked={backupEnabled} onChange={e => setBackupEnabled(e.target.checked)}/>{t('Automatic backups')}</label><div className="settings-columns"><label>{t('Interval (minutes)')}<input type="number" min="15" max="10080" value={interval} onChange={e => setInterval(e.target.value)} required/></label><label>{t('Keep backups')}<input type="number" min="1" max="60" value={retain} onChange={e => setRetain(e.target.value)} required/></label></div><button className="primary-button">{t('Save changes')}</button></form></fieldset>{!data.capabilities?.system && <div className="info-note">{t('Only a non-demo Super Admin can run or change backups.')}</div>}<div className="info-note">{t("The app checks for overdue backups every minute while running. Completed snapshots are integrity-checked and file hashes are verified before retention removes older verified snapshots. Copy backups off this disk for disaster recovery. Never restore over a running server.")}</div></section>}
    {tab === 'Audit log' && <section className="admin-card"><h2 className="admin-section-title">{t('Audit log')}</h2><p className="setting-description">{t("Most recent 100 security, sharing, download and administrator events.")}</p><div className="admin-table-wrap"><table><thead><tr><th>{t("Time")}</th><th>{t("Actor")}</th><th>{t("Action")}</th><th>{t("Details")}</th></tr></thead><tbody>{data.events.map(event => <tr key={event.id}><td>{new Date(event.created).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</td><td>{t(event.actor || 'System / public link')}</td><td>{t(event.action)}</td><td>{event.detail}</td></tr>)}</tbody></table></div></section>}</>}</div>;
    return <div className="admin-embedded"><div className="admin-embedded-bar"><h1>{(() => { const Icon = sectionIcons[tab]; return Icon && <Icon size={26}/>; })()}{t(tab)}</h1>{refreshButton}</div>{content}</div>;
}
