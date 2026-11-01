'use client';
import { LanguageSwitcher } from './language-switcher';
import { useLocale } from './preferences';
import { BrandIcon } from '@/components/brand-icon';
import { useEffect, useState } from 'react';
import { ArrowRight, Folder, LoaderCircle, LockKeyhole, Search, ShieldCheck, Sparkles } from 'lucide-react';
export function AuthForm({ onSuccess }: {
    onSuccess: () => Promise<void>;
}) {
    const { t, language, setLanguage } = useLocale();
    const [mfa, setMfa] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [demos, setDemos] = useState<{
        name: string;
        email: string;
        password: string;
        role: string;
        department: string;
        label: string;
        description: string;
    }[]>([]);
    useEffect(() => { const controller = new AbortController(); void fetch('/api/auth/config', { signal: controller.signal }).then(r => r.ok ? r.json() : {}).then(data => setDemos((data as {
        demoAccounts?: typeof demos;
    }).demoAccounts || [])).catch(() => { }); return () => controller.abort(); }, []);
    async function demoLogin(account: typeof demos[number]) {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
            const data = await response.json();
            if (!response.ok)
                throw Error(data.error || 'Unable to sign in.');
            if (data.mfaRequired)
                throw Error('This demo account requires administrator maintenance.');
            await onSuccess();
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to connect. Please try again.');
        }
        finally {
            setBusy(false);
        }
    }
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setBusy(true);
        setError('');
        const fields = Object.fromEntries(new FormData(e.currentTarget));
        try {
            const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.error || 'Unable to sign in.');
            if (data.mfaRequired) {
                setMfa(true);
                return;
            }
            await onSuccess();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to connect. Please try again.');
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="auth-page"><div className="auth-story"><a href="/" className="brand"><BrandIcon size={34}/><span>{t("NexaFile")}</span></a><div className="auth-story-content"><span className="auth-eyebrow">{t("A CLEARER SPACE FOR YOUR IDEAS")}</span><h1>{t("Your files.")}{" "}<br />{t("A little more")}{" "}<br /><em>{t("organized.")}</em></h1><p>{t("Everything you\u2019re working on, together in one thoughtful workspace.")}</p><div className="auth-illustration"><span className="auth-floating-folder one"><Folder size={44}/></span><span className="auth-floating-folder two"><Search size={32}/></span><span className="auth-floating-folder three"><Sparkles size={28}/></span><div className="auth-mini-card"><div><span className="folder-shape blue"/><span className="folder-shape purple"/><span className="folder-shape green"/></div><i /><i /><i /></div></div></div><span className="auth-story-footer"><ShieldCheck size={15}/>{t("Your workspace. Your permissions. Your files.")}</span></div><div className="auth-form-side"><div className="auth-form-container"><div className="auth-lock"><LockKeyhole size={24}/></div><h2>{t('Welcome back.')}</h2><p>{t('Sign in to pick up where you left off.')}</p><form onSubmit={submit}><label>{t("Email address")}<input type="email" name="email" autoComplete="email" required maxLength={254} placeholder={t("you@example.com")} disabled={busy}/></label><label>{t("Password")}<input type="password" name="password" autoComplete="current-password" required minLength={10} maxLength={128} placeholder={t("At least 10 characters")} disabled={busy}/></label>{mfa && <label>{t('Authenticator or recovery code')}<input name="code" autoComplete="one-time-code" required maxLength={40} disabled={busy}/></label>}{error && <p className="form-error" role="alert">{t(error)}</p>}<button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <>{t('Sign in')}<ArrowRight size={17}/></>}</button></form>{demos.length > 0 && <section className="demo-accounts" aria-labelledby="demo-heading"><div className="demo-heading"><h3 id="demo-heading">{t('Demo accounts')}</h3><span>{t('Try a role')}</span></div><p>{t('Choose an account to sign in instantly. Demo administrators manage demo accounts only.')}</p><div className="demo-account-list">{demos.map(account => <button type="button" key={account.email} className="demo-account" disabled={busy} onClick={() => void demoLogin(account)}><span className={'demo-role-icon ' + account.role}><ShieldCheck size={20}/></span><span><strong>{t(account.label)}</strong><small>{t(account.description)}</small><span className="demo-email">{account.email}</span></span><ArrowRight size={17}/></button>)}</div><div className="demo-password"><span>{t('Demo password')}</span><code>{demos[0].password}</code></div></section>}<div className="auth-options"><LanguageSwitcher /></div><p className="auth-switch"><a href={`/about/${language}`} className="text-button">{t('About NexaFile')}</a></p><div className="auth-security"><ShieldCheck size={15}/><span>{t("Files are stored on this server. Only you and the people you share with can access them.")}</span></div></div></div></main>;
}
