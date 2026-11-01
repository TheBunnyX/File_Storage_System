'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Languages, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useLocale } from './preferences';
type Security = {
    mfa: boolean;
    role: string;
    recoveryRemaining: number;
    sessions: {
        expires: number;
    }[];
};
async function request<T>(path: string, body?: unknown) { const response = await fetch(`/api/auth/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await response.json(); if (!response.ok)
    throw new Error(value.error || 'Request failed.'); return value as T; }
export function AccountSettings({ onSaved, onBusy }: {
    onSaved: () => Promise<void>;
    onBusy?: (busy: boolean) => void;
}) {
    const { t, language, theme, setLanguage, setTheme } = useLocale();
    const [security, setSecurity] = useState<Security | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const [password, setPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirm, setConfirm] = useState(''), [code, setCode] = useState('');
    const [setup, setSetup] = useState<{
        secret: string;
        qr: string;
    } | null>(null), [recovery, setRecovery] = useState<string[]>([]);
    const load = async () => setSecurity(await request<Security>('security'));
    useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
    useEffect(() => { void load().catch(err => setError(err.message)); }, []);
    async function act(action: string, body: unknown) { setBusy(true); setError(''); setMessage(''); try {
        const result = await request<{
            message?: string;
            secret?: string;
            qr?: string;
            recoveryCodes?: string[];
        }>(action, body);
        if (result.secret && result.qr)
            setSetup({ secret: result.secret, qr: result.qr });
        if (result.recoveryCodes) {
            setRecovery(result.recoveryCodes);
            setSetup(null);
        }
        if (action === 'mfa-disable')
            setSetup(null);
        if (action === 'change-password') {
            setNewPassword('');
            setConfirm('');
        }
        if (action !== 'mfa-setup') {
            setMessage(result.message || 'Changes saved.');
            setCode('');
            await load();
            await onSaved();
        }
    }
    catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed.');
    }
    finally {
        setBusy(false);
    } }
    return <div className="settings-stack"><section className="settings-section"><h3><Languages size={18}/>{t('Appearance')}</h3><div className="settings-columns"><label>{t('Language')}<select value={language} onChange={e => setLanguage(e.target.value as 'en' | 'th')}><option value="en">{t("English")}</option><option value="th">{t("\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22")}</option></select></label><label>{t('Theme')}<select value={theme} onChange={e => setTheme(e.target.value as 'light' | 'dark' | 'system')}><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option><option value="system">{t('System')}</option></select></label></div><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); try {
        const res = await fetch('/api/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, theme }) });
        const body = await res.json();
        if (!res.ok)
            throw new Error(body.error);
        setMessage('Preferences saved.');
        await onSaved();
    }
    catch (err) {
        setError((err as Error).message);
    }
    finally {
        setBusy(false);
    } }}>{t('Save changes')}</button></section>
    {error && <div className="form-error" role="alert">{t(error)}</div>}{message && <div className="success-note" role="status"><Check size={15}/>{t(message)}</div>}
    {!security ? <LoaderCircle className="spin" size={22}/> : <><section className="settings-section"><h3><ShieldCheck size={18}/>{t('Account security')}</h3><p className="setting-description">{security.sessions.length} {t("active sessions")}</p>
    <form className="dialog-form" onSubmit={e => { e.preventDefault(); if (newPassword !== confirm) {
            setError('The new passwords do not match.');
            return;
        } void act('change-password', { currentPassword: password, password: newPassword, code }); }}><label>{t('Current password')}<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label><div className="settings-columns"><label>{t('New password')}<input type="password" minLength={10} maxLength={128} required autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label><label>{t('Confirm password')}<input type="password" minLength={10} required autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}/></label></div>{security.mfa && <label>{t('Authenticator or recovery code')}<input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" required/></label>}<button className="primary-button" disabled={busy}>{t('Change password')}</button></form></section>
    <section className="settings-section"><h3><KeyRound size={18}/>{t('Two-factor authentication')}</h3><p className="setting-description">{t(security.mfa ? 'Enabled' : 'Not enabled')}{security.mfa && ` · ${security.recoveryRemaining} ${t('recovery codes remaining')}`}</p><div className="dialog-form"><label>{t('Current password')}<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label>{setup && <div className="mfa-setup"><img src={setup.qr} width={220} height={220} alt={t("Authenticator setup QR code")}/><p>{t("Scan in your authenticator app, or enter this secret manually:")}</p><code>{setup.secret}</code><p className="field-hint">{t("Setup expires in 10 minutes. Your account is protected only after confirmation.")}</p></div>}{(security.mfa || setup) && <label>{t(security.mfa ? 'Authenticator or recovery code' : 'Authenticator code')}<input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" maxLength={40}/></label>}{security.mfa ? <button className="secondary-button" disabled={busy || !password || !code} onClick={() => void act('mfa-disable', { currentPassword: password, code })}>{t('Disable two-factor')}</button> : <button className="secondary-button" disabled={busy || !password || !!setup && !code} onClick={() => void act(setup ? 'mfa-enable' : 'mfa-setup', { currentPassword: password, code })}>{t(setup ? 'Enable two-factor' : 'Set up authenticator')}</button>}<button className="secondary-button" disabled={busy || !password || security.mfa && !code} onClick={() => void act('revoke-sessions', { currentPassword: password, code })}>{t('Revoke other sessions')}</button></div>{recovery.length > 0 && <div className="recovery-codes"><h4>{t('Save your recovery codes')}</h4><p>{t('Each recovery code can be used once. Store these offline.')}</p><div>{recovery.map(item => <code key={item}>{item}</code>)}</div><button className="text-button" onClick={() => void navigator.clipboard.writeText(recovery.join('\n')).then(() => setMessage('Recovery codes copied.')).catch(() => setError('Clipboard is unavailable. Copy the codes manually.'))}><Copy size={14}/>{t("Copy recovery codes")}</button></div>}</section>
</>}
    <section className="settings-section"><h3>{t('Shortcuts')}</h3><div className="shortcut-row"><kbd>{t("Ctrl / \u2318 K")}</kbd><span>{t('Search')}</span></div><div className="shortcut-row"><kbd>{t("Esc")}</kbd><span>{t('Close panel / dialog')}</span></div><div className="shortcut-row"><kbd>{t("/")}</kbd><span>{t('Search')}</span></div></section>
  </div>;
}
