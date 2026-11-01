'use client';
import { useLocale } from './preferences';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, LoaderCircle } from 'lucide-react';
import type { FileDetails, FileItem } from '@/lib/types';
function PDFPreview({ file }: {
    file: FileItem;
}) {
    const { t } = useLocale();
    const [page, setPage] = useState(1), [total, setTotal] = useState(1), [image, setImage] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        let objectUrl = '';
        setLoading(true);
        setError('');
        setImage('');
        fetch(`/api/files/${file.id}/preview?page=${page}`, { signal: abort.signal, cache: 'no-store' }).then(async (res) => {
            if (!res.ok)
                throw new Error((await res.json()).error || 'Preview unavailable.');
            const blob = await res.blob();
            if (abort.signal.aborted)
                return;
            objectUrl = URL.createObjectURL(blob);
            setImage(objectUrl);
            setTotal(Number(res.headers.get('X-PDF-Pages')) || 1);
        }).catch(err => {
            if (!abort.signal.aborted)
                setError(err.message);
        }).finally(() => {
            if (!abort.signal.aborted)
                setLoading(false);
        });
        return () => {
            abort.abort();
            if (objectUrl)
                URL.revokeObjectURL(objectUrl);
        };
    }, [file.id, file.version, page, retry]);
    return <div className="pdf-pages">{loading ? <div className="preview-unavailable"><LoaderCircle size={24} className="spin"/><p>{t("Rendering PDF page\u2026")}</p></div> : error ? <div className="preview-unavailable"><FileText size={24}/><p role="alert">{t(error)}</p><button className="text-button" onClick={() => setRetry(n => n + 1)}>{t("Retry preview")}</button><a href={`${file.url}?download=1`}><Download size={14}/>{t("Download original")}</a></div> : <img src={image} alt={t('{name}, page {page} of {total}',{name:file.name,page,total})}/>}<div className="pdf-pagination"><button aria-label={t("Previous PDF page")} disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={15}/></button><span>{t("Page")}{page}{t("of")}{total}</span><button aria-label={t("Next PDF page")} disabled={loading || page >= total} onClick={() => setPage(n => n + 1)}><ChevronRight size={15}/></button></div></div>;
}
export function FilePreview({ details, expanded = false }: {
    details: FileDetails;
    expanded?: boolean;
}) {
    const { t } = useLocale();
    const { file, text } = details, url = file.url;
    const body = file.type === 'Image' ? <img src={url} alt={file.name}/> : file.type === 'PDF' ? <PDFPreview key={`${file.id}:${file.version}`} file={file}/> : file.type === 'Video' ? <video src={url} controls preload="metadata"/> : file.type === 'Audio' ? <audio src={url} controls preload="metadata"/> : text ? <pre>{text}</pre> : <div className="preview-unavailable"><FileText size={34}/><strong>{t("No preview for this format")}</strong><p>{file.extractionStatus}</p><a href={`${url}?download=1`}><Download size={15}/>{t("Download original")}</a></div>;
    return <div className={`real-preview ${expanded ? 'expanded' : ''}`}>{body}{!expanded && <a className="open-preview" href={url} target="_blank" rel="noopener noreferrer" aria-label={t("Open file in new tab")}><ExternalLink size={14}/></a>}</div>;
}
