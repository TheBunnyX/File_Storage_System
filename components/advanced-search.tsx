'use client';
import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { FileItem } from '@/lib/types';
import { useLocale } from './preferences';
export type SearchFilters = {
    owner: string;
    after: string;
    before: string;
    min: string;
    max: string;
};
export const emptySearchFilters: SearchFilters = { owner: '', after: '', before: '', min: '', max: '' };
export function matchesAdvanced(file: FileItem, filters: SearchFilters) { return (!filters.owner || file.ownerId === Number(filters.owner)) && (!filters.after || new Date(file.modified) >= new Date(`${filters.after}T00:00:00`)) && (!filters.before || new Date(file.modified) <= new Date(`${filters.before}T23:59:59.999`)) && (!filters.min || file.bytes >= Number(filters.min) * 1048576) && (!filters.max || file.bytes <= Number(filters.max) * 1048576); }
export function AdvancedSearch({ files, value, onChange }: {
    files: FileItem[];
    value: SearchFilters;
    onChange: (filters: SearchFilters) => void;
}) { const { t } = useLocale(); const [open, setOpen] = useState(false); const owners = [...new Map(files.map(file => [file.ownerId, file.ownerName])).entries()]; const count = Object.values(value).filter(Boolean).length; return <div className="advanced-search"><div><button className="text-button" onClick={() => setOpen(!open)}><SlidersHorizontal size={14}/>{t('Advanced search')}{count > 0 && <span className="section-count">{count}</span>}</button>{count > 0 && <button className="text-button" onClick={() => onChange(emptySearchFilters)}><X size={13}/>{t('Clear filters')}</button>}</div>{open && <div className="advanced-fields"><label>{t('Owner')}<select value={value.owner} onChange={e => onChange({ ...value, owner: e.target.value })}><option value="">{t('All owners')}</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>{t('Modified after')}<input type="date" value={value.after} onChange={e => onChange({ ...value, after: e.target.value })}/></label><label>{t('Modified before')}<input type="date" value={value.before} onChange={e => onChange({ ...value, before: e.target.value })}/></label><label>{t('Minimum size (MB)')}<input type="number" min="0" step="any" value={value.min} onChange={e => onChange({ ...value, min: e.target.value })}/></label><label>{t('Maximum size (MB)')}<input type="number" min="0" step="any" value={value.max} onChange={e => onChange({ ...value, max: e.target.value })}/></label></div>}</div>; }
