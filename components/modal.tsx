'use client';
import { useLocale } from './preferences';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({ title, onClose, children, wide = false }: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    wide?: boolean;
}) {
    const { t } = useLocale();
    const ref = useRef<HTMLElement>(null), closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        const active = document.activeElement as HTMLElement | null;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        (ref.current?.querySelector<HTMLElement>('input,textarea,select') || ref.current?.querySelector<HTMLElement>('button'))?.focus();
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closeRef.current();
            }
            if (e.key === 'Tab') {
                const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]') || []).filter(el => el.offsetParent !== null);
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                }
                if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener('keydown', key);
        return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); active?.focus(); };
    }, []);
    return <div className="modal-backdrop" onClick={e => {
            if (e.target === e.currentTarget)
                onClose();
        }}><section ref={ref} className={`modal live-modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">{t(title)}</h2><button className="modal-close icon-button" aria-label={t("Close dialog")} onClick={onClose}><X size={20}/></button>{children}</section></div>;
}
