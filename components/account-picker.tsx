'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useLocale } from './preferences';
import type { User } from '@/lib/types';
type Person = Pick<User, 'id' | 'name' | 'email'>;
export function AccountPicker({ value, onChange, exclude = [], disabled, placeholder }: {
    value: string;
    onChange: (email: string) => void;
    exclude?: string[];
    disabled?: boolean;
    placeholder?: string;
}) {
    const { t } = useLocale();
    const listId = useId(), root = useRef<HTMLDivElement>(null);
    const [results, setResults] = useState<Person[]>([]), [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [active, setActive] = useState(-1), [searched, setSearched] = useState(false);
    const blocked = exclude.join('|').toLowerCase();
    useEffect(() => {
        const term = value.trim();
        if (!open || term.length < 2) {
            setResults([]);
            setSearched(false);
            setLoading(false);
            return;
        }
        const abort = new AbortController();
        setLoading(true);
        const timer = setTimeout(() => {
            fetch(`/api/users?q=${encodeURIComponent(term)}`, { signal: abort.signal, cache: 'no-store' })
                .then(res => res.ok ? res.json() : { users: [] })
                .then((data: { users: Person[] }) => {
                if (abort.signal.aborted)
                    return;
                const skip = new Set(blocked ? blocked.split('|') : []);
                setResults(data.users.filter(person => !skip.has(person.email.toLowerCase())));
                setActive(-1);
                setSearched(true);
            })
                .catch(() => { if (!abort.signal.aborted)
                setResults([]); })
                .finally(() => { if (!abort.signal.aborted)
                setLoading(false); });
        }, 200);
        return () => { clearTimeout(timer); abort.abort(); };
    }, [value, open, blocked]);
    useEffect(() => {
        const close = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node))
            setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);
    function choose(person: Person) {
        onChange(person.email);
        setOpen(false);
        setActive(-1);
    }
    const showList = open && value.trim().length >= 2 && (loading || searched);
    return <div className="account-picker" ref={root}>
    <input type="email" required value={value} disabled={disabled} autoComplete="off" role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setOpen(true); }} onKeyDown={event => {
            if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault();
                setOpen(true);
                setActive(index => (index + 1) % results.length);
            }
            else if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault();
                setActive(index => (index <= 0 ? results.length : index) - 1);
            }
            else if (event.key === 'Enter' && showList && active >= 0 && results[active]) {
                event.preventDefault();
                choose(results[active]);
            }
            else if (event.key === 'Escape' && showList) {
                event.stopPropagation();
                setOpen(false);
            }
        }}/>
    {showList && <ul className="account-picker-list" id={listId} role="listbox">
      {loading && !results.length ? <li className="account-picker-note" role="status"><LoaderCircle size={14} className="spin"/>{t('Searching…')}</li> : results.length ? results.map((person, index) => <li key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(person)}><strong>{person.name}</strong><small>{person.email}</small></li>) : <li className="account-picker-note" role="status">{t('No matching accounts')}</li>}
    </ul>}
  </div>;
}
