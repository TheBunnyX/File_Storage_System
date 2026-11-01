'use client';
import { useEffect, useState } from 'react';
import { Copy, Link2, Lock, Trash2 } from 'lucide-react';
import { useLocale } from './preferences';
type Link = {
    id: number;
    expires: number;
    download: boolean;
    passwordProtected: boolean;
    created: string;
};
export function PublicLinkManager({ fileId }: {
    fileId: number;
}) {
    const { t, language } = useLocale();
    const [links, setLinks] = useState<Link[]>([]), [url, setUrl] = useState(''), [password, setPassword] = useState(''), [expiry, setExpiry] = useState('86400'), [download, setDownload] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
    useEffect(() => { const abort = new AbortController(); fetch(`/api/files/${fileId}/links`, { cache: 'no-store', signal: abort.signal }).then(async (res) => { const data = await res.json(); if (!res.ok)
        throw new Error(data.error); setLinks(data.links); }).catch(err => { if (!abort.signal.aborted)
        setError(err.message); }); return () => abort.abort(); }, [fileId]);
    async function request(method: string, body?: unknown, id?: number) { setBusy(true); setError(''); try {
        const res = await fetch(`/api/files/${fileId}/links${id ? `?linkId=${id}` : ''}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error);
        setLinks(data.links);
        if (data.url) {
            setUrl(data.url);
            setPassword('');
            setCopied(false);
        }
    }
    catch (err) {
        setError((err as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <><div className="info-note">{t("Anyone with the link and its password can view this file until expiry or revocation. Preview-only restricts original downloads; visible text and images can still be copied or captured.")}</div><form className="dialog-form" onSubmit={e => { e.preventDefault(); void request('POST', { password, expiresIn: Number(expiry), download }); }}><label>{t('Link password (optional)')}<input type="password" autoComplete="new-password" minLength={password ? 10 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label><label>{t('Expiry')}<select value={expiry} onChange={e => setExpiry(e.target.value)}>{[['3600', '1 hour'], ['86400', '1 day'], ['604800', '7 days'], ['2592000', '30 days']].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={download} onChange={e => setDownload(e.target.checked)}/>{t('Allow original downloads')}</label><button className="primary-button" disabled={busy}>{t('Create share link')}</button></form>{error && <p className="form-error" role="alert">{t(error)}</p>}{url && <div className="created-link"><p>{t("This secret link is shown once. Copy it now.")}</p><input readOnly value={url} aria-label={t("Created share link")}/><button className="text-button" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => setError('Clipboard unavailable. Select and copy the link manually.'))}><Copy size={14}/>{copied ? t('Copied') : t('Copy link')}</button></div>}<div className="link-list">{links.map(link => <div key={link.id}><span><Link2 size={16}/>{link.passwordProtected && <Lock size={13}/>}</span><div><strong>{t(link.download ? 'Download allowed' : 'Preview only')}</strong><small>{link.expires < Date.now() ? t('Expired') : new Date(link.expires).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</small></div><button className="icon-button" aria-label={`${t('Revoke')} ${link.id}`} disabled={busy} onClick={() => void request('DELETE', undefined, link.id)}><Trash2 size={15}/></button></div>)}</div></>;
}
