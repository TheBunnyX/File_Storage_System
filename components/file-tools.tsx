'use client';
import { useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import type { FileItem } from '@/lib/types';
import { useLocale } from './preferences';
export function FileTools({ file, scan, onDone, onError }: {
    file: FileItem;
    scan?: {
        status: string;
        checked: string | null;
    };
    onDone: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const { t } = useLocale();
    const [busy, setBusy] = useState('');
    async function run(action: string) { setBusy(action); try {
        const res = await fetch(`/api/files/${file.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error);
        await onDone();
    }
    catch (err) {
        onError((err as Error).message);
    }
    finally {
        setBusy('');
    } }
    return <div className="file-tools"><p><ShieldCheck size={13}/>{t('Antivirus')}{t(":")}{t(scan?.status === 'clean' ? 'Clean' : scan?.status === 'not-configured' ? 'Not configured' : scan?.status === 'infected' ? 'Blocked' : 'Not scanned')}</p><div>{file.permission === 'owner' && <button className="secondary-button" disabled={!!busy} onClick={() => void run('scan')}>{busy === 'scan' ? <LoaderCircle size={15} className="spin"/> : <ShieldCheck size={15}/>} {t('Scan for viruses')}</button>}</div></div>;
}
