'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, FileUp, LoaderCircle, Pause, Play, Upload, X } from 'lucide-react';
import { formatBytes } from '@/lib/types';
import { useLocale } from './preferences';
type ServerUpload = {
    id: string;
    name: string;
    size: number;
    offset: number;
    hash: string;
    folderId: number | null;
    fileId: number | null;
    status: string;
    expires: number;
    resultId: number | null;
};
type Job = {
    key: string;
    name: string;
    size: number;
    hash: string;
    folderId: number | null;
    fileId: number | null;
    serverId?: string;
    file?: File;
    offset: number;
    status: 'pending' | 'uploading' | 'saving' | 'paused' | 'complete' | 'failed';
    error?: string;
    auto?: boolean;
};
export type UploadManagerRef = {
    add: (files: File[], folderId: number | null, fileId?: number) => Promise<void>;
};
class UploadError extends Error {
    constructor(message: string, public status = 0) { super(message); }
}
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms); const abort = () => { clearTimeout(timer); reject(new DOMException('Paused', 'AbortError')); }; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted)
    abort(); });
async function send<T>(url: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0;; attempt++) {
        try {
            const res = await fetch(url, { ...options, signal, cache: 'no-store' });
            const result = await res.json();
            if (!res.ok)
                throw new UploadError(result.error || 'Upload failed.', res.status);
            return result;
        }
        catch (err) {
            if (signal?.aborted || attempt >= 3 || err instanceof UploadError && ![409, 429, 500, 502, 503, 504].includes(err.status) || !signal)
                throw err;
            await wait([500, 2000, 8000][attempt], signal);
        }
    }
}
const fingerprint = async (file: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
export const UploadManager = forwardRef<UploadManagerRef, {
    userId: number;
    maxUpload: number;
    onDone: () => Promise<void>;
    onError: (message: string) => void;
}>(function UploadManager({ userId, maxUpload, onDone, onError }, ref) {
    const { t } = useLocale();
    const [jobs, setJobs] = useState<Job[]>([]), [collapsed, setCollapsed] = useState(false), [hashing, setHashing] = useState(false);
    const active = useRef<{
        key: string;
        controller: AbortController;
    } | null>(null), latest = useRef(jobs), alive = useRef(true), callbacks = useRef({ onDone, onError });
    callbacks.current = { onDone, onError };
    latest.current = jobs;
    const input = useRef<HTMLInputElement>(null), chooseKey = useRef<string | null>(null);
    const update = (key: string, values: Partial<Job>) => { if (alive.current)
        setJobs(prev => prev.map(job => job.key === key ? { ...job, ...values } : job)); };
    useEffect(() => {
        alive.current = true;
        const controller = new AbortController();
        send<{
            uploads: ServerUpload[];
        }>('/api/uploads', {}, controller.signal).then(({ uploads }) => { if (alive.current)
            setJobs(prev => [...prev, ...uploads.filter(upload => !prev.some(j => j.serverId === upload.id)).map(upload => ({ key: upload.id, name: upload.name, size: upload.size, hash: upload.hash, folderId: upload.folderId, fileId: upload.fileId, serverId: upload.id, offset: upload.offset, status: 'paused' as const, error: 'Select the original file to resume. Chunks are retained for 24 hours.' }))]); }).catch(err => { if (!controller.signal.aborted)
            callbacks.current.onError(err.message); });
        const online = () => setJobs(prev => prev.map(j => j.status === 'paused' && j.auto && j.file ? { ...j, status: 'pending', error: '' } : j));
        window.addEventListener('online', online);
        return () => { alive.current = false; controller.abort(); active.current?.controller.abort(); window.removeEventListener('online', online); };
    }, [userId]);
    // Finished uploads dismiss themselves so the queue stops covering the file list.
    useEffect(() => {
        if (!jobs.some(j => j.status === 'complete'))
            return;
        const timer = setTimeout(() => { if (alive.current)
            setJobs(prev => prev.filter(j => j.status !== 'complete')); }, 6000);
        return () => clearTimeout(timer);
    }, [jobs]);
    useImperativeHandle(ref, () => ({ add: async (files, folderId, fileId) => { if (files.length > 10 || files.some(f => f.size > maxUpload))
            throw new Error('Choose up to 10 files within the upload size limit.'); if (latest.current.filter(j => j.status !== 'complete').length + files.length > 30)
            throw new Error('The upload queue is full. Remove an old item first.'); setHashing(true); setCollapsed(false); try {
            for (const file of files) {
                const hash = await fingerprint(file);
                if (!alive.current)
                    return;
                setJobs(prev => { const old = prev.find(j => j.hash === hash && j.name === file.name && j.folderId === folderId && j.fileId === (fileId || null) && j.status !== 'complete'); return old ? prev.map(j => j.key === old.key ? { ...j, file, status: 'pending', error: '' } : j) : [...prev, { key: crypto.randomUUID(), name: file.name, size: file.size, hash, folderId, fileId: fileId || null, file, offset: 0, status: 'pending' }]; });
            }
        }
        finally {
            if (alive.current)
                setHashing(false);
        } } }), [maxUpload, userId]);
    useEffect(() => {
        if (active.current)
            return;
        const job = jobs.find(j => j.status === 'pending' && j.file);
        if (!job)
            return;
        const controller = new AbortController();
        active.current = { key: job.key, controller };
        void (async () => {
            try {
                update(job.key, { status: 'uploading', error: '', auto: false });
                let state: ServerUpload = job.serverId ? await send(`/api/uploads/${job.serverId}`, {}, controller.signal) : await send('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: job.name, size: job.size, hash: job.hash, folderId: job.folderId, fileId: job.fileId }) }, controller.signal);
                update(job.key, { serverId: state.id, offset: state.offset });
                while (state.offset < job.size && state.status !== 'complete') {
                    const before = state.offset;
                    try {
                        state = await send(`/api/uploads/${state.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(before) }, body: job.file!.slice(before, Math.min(before + 1048576, job.size)) }, controller.signal);
                    }
                    catch (err) {
                        if (controller.signal.aborted)
                            throw err;
                        const actual = await send<ServerUpload>(`/api/uploads/${state.id}`, {}, controller.signal);
                        if (actual.offset <= before)
                            throw err;
                        state = actual;
                    }
                    if (state.offset <= before)
                        throw new Error('Upload did not advance. Pause and retry.');
                    update(job.key, { offset: state.offset });
                }
                if (state.status !== 'complete') {
                    update(job.key, { status: 'saving' });
                    await send(`/api/uploads/${state.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, controller.signal);
                }
                update(job.key, { status: 'complete', offset: job.size, file: undefined, error: '' });
                await callbacks.current.onDone();
            }
            catch (err) {
                if (controller.signal.aborted)
                    update(job.key, { status: 'paused', auto: false });
                else {
                    const message = err instanceof Error ? err.message : 'Upload failed.';
                    const recoverable = !(err instanceof UploadError) || [409, 429, 500, 502, 503, 504].includes(err.status);
                    update(job.key, { status: recoverable ? 'paused' : 'failed', error: message, auto: recoverable });
                    callbacks.current.onError(message);
                }
            }
            finally {
                active.current = null;
                if (alive.current)
                    setJobs(prev => [...prev]);
            }
        })();
    }, [jobs]);
    async function cancel(job: Job) { if (job.status === 'saving')
        return; if (active.current?.key === job.key)
        active.current.controller.abort(); try {
        if (job.serverId)
            await send(`/api/uploads/${job.serverId}`, { method: 'DELETE' }, new AbortController().signal);
        setJobs(prev => prev.filter(j => j.key !== job.key));
    }
    catch (err) {
        update(job.key, { status: 'paused', error: (err as Error).message });
    } }
    if (!jobs.length && !hashing)
        return null;
    return <section className={`upload-queue ${collapsed ? 'collapsed' : ''}`} aria-label={t('Upload queue')}><header><Upload size={17}/><strong>{t('Upload queue')}</strong><span>{jobs.filter(j => j.status === 'complete').length}{t("/")}{jobs.length}</span><button aria-label={t(collapsed ? 'Expand uploads' : 'Collapse uploads')} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '+' : '−'}</button></header>{!collapsed && <><div className="upload-queue-list">{hashing && <p className="queue-hashing"><LoaderCircle size={15} className="spin"/>{t("Checking file fingerprints\u2026")}</p>}{jobs.map(job => <div className="upload-job" key={job.key}><div><FileUp size={18}/><strong title={job.name}>{job.name}</strong>{job.status === 'complete' ? <Check size={17} className="green-text"/> : job.status === 'saving' ? <LoaderCircle size={16} className="spin"/> : job.status === 'uploading' ? <button aria-label={`${t('Pause')} ${job.name}`} onClick={() => active.current?.controller.abort()}><Pause size={15}/></button> : <button aria-label={`${t('Resume')} ${job.name}`} onClick={() => { if (job.file)
        update(job.key, { status: 'pending', error: '' });
    else {
        chooseKey.current = job.key;
        input.current?.click();
    } }}><Play size={15}/></button>}{job.status !== 'saving' && <button aria-label={`${t('Remove')} ${job.name}`} onClick={() => void cancel(job)}><X size={15}/></button>}</div><div className="progress"><i style={{ width: `${job.size ? Math.round(job.offset / job.size * 100) : job.status === 'complete' ? 100 : 0}%` }}/></div><p>{formatBytes(job.offset)}{t("/")}{formatBytes(job.size)} {t("\u00B7")}{" "}{t(job.status === 'uploading' ? 'Uploading' : job.status === 'saving' ? 'Verifying & saving…' : job.status === 'complete' ? 'Complete' : job.status === 'pending' ? 'Waiting' : 'Paused')}</p>{job.error && <small role="status">{t(job.error)}</small>}{!job.file && job.status !== 'complete' && <button className="text-button" onClick={() => { chooseKey.current = job.key; input.current?.click(); }}>{t('Select file to resume')}</button>}</div>)}</div>{jobs.some(j => j.status === 'complete') && <button className="clear-uploads" onClick={() => setJobs(prev => prev.filter(j => j.status !== 'complete'))}>{t('Clear completed')}</button>}</>}<input ref={input} type="file" className="hidden-input" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; const job = latest.current.find(j => j.key === chooseKey.current); if (!file || !job)
        return; try {
        if (file.size !== job.size || await fingerprint(file) !== job.hash)
            throw new Error('Select the same original file. The content fingerprint did not match.');
        update(job.key, { file, status: 'pending', error: '' });
    }
    catch (err) {
        callbacks.current.onError((err as Error).message);
    } }}/></section>;
});
