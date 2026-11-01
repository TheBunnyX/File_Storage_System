'use client';
import { LanguageSwitcher } from './language-switcher';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, LoaderCircle, Lock, ShieldCheck } from 'lucide-react';
import { BrandIcon } from './brand-icon';
import { useLocale } from './preferences';
import { formatBytes } from '@/lib/types';
type Shared = {
    locked: boolean;
    name: string;
    type: string;
    bytes: number;
    download: boolean;
    expires: number;
    text: string;
    extractionStatus: string;
};
export function SharedFile({ token }: {
    token: string;
}) {
    const { t, language, setLanguage } = useLocale();
    const [data, setData] = useState<Shared | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(1), [total, setTotal] = useState(1), [image, setImage] = useState(''), [revision, setRevision] = useState(0), [rendering, setRendering] = useState(false);
    const base = `/api/public/${token}`;
    useEffect(() => { const abort = new AbortController(); fetch(base, { signal: abort.signal, cache: 'no-store' }).then(async (res) => { const result = await res.json(); if (!res.ok)
        throw new Error(result.error); setData(result); setError(''); }).catch(err => { if (!abort.signal.aborted)
        setError(err.message); }); return () => abort.abort(); }, [base, revision]);
    useEffect(() => { if (!data || data.locked || data.type !== 'PDF')
        return; const abort = new AbortController(); let object = ''; setRendering(true); setImage(''); fetch(`${base}/preview?page=${page}`, { signal: abort.signal, cache: 'no-store' }).then(async (res) => { if (!res.ok)
        throw new Error((await res.json()).error); const blob = await res.blob(); if (abort.signal.aborted)
        return; object = URL.createObjectURL(blob); setImage(object); setTotal(Number(res.headers.get('X-PDF-Pages')) || 1); }).catch(err => { if (!abort.signal.aborted)
        setError(err.message); }).finally(() => { if (!abort.signal.aborted)
        setRendering(false); }); return () => { abort.abort(); if (object)
        URL.revokeObjectURL(object); }; }, [base, page, data?.locked, data?.type, revision]);
    return <main className="shared-page"><header><a className="brand" href="/"><BrandIcon /><span>{t("NexaFile")}</span></a><LanguageSwitcher /></header><section className="shared-card"><span className="shared-label"><ShieldCheck size={15}/>{t('Shared with NexaFile')}</span><h1>{data?.name || t('Shared file')}</h1>{error && <p className="form-error" role="alert">{t(error)}</p>}{!data && !error && <LoaderCircle className="spin" size={24}/>} {data?.locked ? <form className="dialog-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); const body = Object.fromEntries(new FormData(e.currentTarget)); try {
        const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error);
        setRevision(n => n + 1);
    }
    catch (err) {
        setError((err as Error).message);
    }
    finally {
        setBusy(false);
    } }}><p>{t('This link is password protected.')}</p><label>{t('Password')}<input name="password" type="password" autoComplete="off" required/></label><button className="primary-button" disabled={busy}><Lock size={15}/>{t('Unlock')}</button></form> : data && <><p className="shared-meta">{t(data.type)} {t("\u00B7")} {formatBytes(data.bytes)} {" "}{t("\u00B7")}{" "}{t('Expiry')}{t(":")}{new Date(data.expires).toLocaleString()}</p><div className="shared-preview">{data.type === 'PDF' ? <><div className="shared-pdf-page">{rendering ? <LoaderCircle className="spin" size={24}/> : image && <img src={image} alt={t('{name}, page {page}',{name:data.name,page})}/>}</div><div className="pdf-pagination"><button aria-label={t("Previous page")} disabled={rendering || page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={16}/></button><span>{page}{t("/")}{total}</span><button aria-label={t("Next page")} disabled={rendering || page >= total} onClick={() => setPage(n => n + 1)}><ChevronRight size={16}/></button></div></> : data.type === 'Image' ? <img src={`${base}/preview`} alt={data.name}/> : data.text ? <pre>{data.text}</pre> : data.download && data.type === 'Video' ? <video src={`${base}/preview`} controls/> : data.download && data.type === 'Audio' ? <audio src={`${base}/preview`} controls/> : <p className="info-note">{t(data.download ? 'Download the original to open this format.' : 'The owner has disabled original downloads. A preview is not available for this format.')}</p>}</div>{data.download ? <a className="primary-button" href={`${base}/download`}><Download size={16}/>{t('Download original')}</a> : <p className="field-hint">{t('Preview only')}{t("\u00B7 Original downloads are disabled. Visible content can still be copied or captured.")}</p>}</>}</section></main>;
}
