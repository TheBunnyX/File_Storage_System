'use client';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useLocale } from '@/components/preferences';
import { AccountSettings } from '@/components/account-settings';
import { AccountPicker } from '@/components/account-picker';
import { UploadManager, type UploadManagerRef } from '@/components/upload-manager';
import { AdvancedSearch, emptySearchFilters, matchesAdvanced } from '@/components/advanced-search';
import { PublicLinkManager } from '@/components/public-link-manager';
import { FileTools } from '@/components/file-tools';
import { BrandIcon } from '@/components/brand-icon';
import { adminSections, sectionIcons } from '@/components/admin-sections';
import { AdminPanel } from '@/components/admin-panel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUpDown, Bell, Check, ChevronDown, ChevronRight, Clock3, Cloud, Copy, Download, Ellipsis, Expand, FileImage, FileSpreadsheet, FileText, Folder, FolderOpen, Grid2X2, HardDrive, House, LayoutList, LoaderCircle, LogOut, Menu, Plus, RefreshCw, Search, ShieldCheck, Star, Tag, Trash2, Upload, Users, X, Settings2 } from 'lucide-react';
import { AuthForm } from '@/components/auth-form';
import { Modal } from '@/components/modal';
import { FilePreview } from '@/components/file-preview';
import { FOLDER_COLORS, formatBytes, type FileDetails, type FileItem, type FolderItem, type Share, type Workspace } from '@/lib/types';
class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, { ...options, cache: 'no-store', headers: { ...(options?.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
    const data = await res.json();
    if (!res.ok)
        throw new ApiError(data.error || 'The request failed.', res.status);
    return data;
}
const mutate = <T,>(url: string, method: string, body?: unknown) => api<T>(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const navigation = [{ name: 'My Files', icon: Folder }, { name: 'Shared', icon: Users }, { name: 'Favorites', icon: Star }, { name: 'Trash', icon: Trash2 }];
const SIDEBAR_KEY = 'nexafile-sidebar', DRAWER_QUERY = '(max-width: 1024px)';
const folderColorNames: Record<string, string> = { yellow: 'Yellow', orange: 'Orange', red: 'Red', pink: 'Pink', purple: 'Purple', blue: 'Blue', teal: 'Teal', green: 'Green', gray: 'Gray' };
const filters = ['All', 'Documents', 'Images', 'Spreadsheets', 'Presentations', 'PDFs', 'Media', 'Other'];
const filterTypes: Record<string, string> = { Documents: 'Document', Images: 'Image', Spreadsheets: 'Spreadsheet', Presentations: 'Presentation', PDFs: 'PDF', Other: 'Other' };
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = (value: string) => new Date(value).toLocaleString();
function FileIcon({ type }: {
    type: string;
}) { const Icon = type === 'Spreadsheet' ? FileSpreadsheet : type === 'Image' ? FileImage : type === 'Presentation' ? Copy : FileText; return <span className={`file-icon ${type.toLowerCase()}`}><Icon size={18} strokeWidth={1.7}/></span>; }
function Avatar({ name, small = false }: {
    name: string;
    small?: boolean;
}) { return <span className={`user-avatar ${small ? 'small' : ''}`}>{name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase()}</span>; }
type ShareTarget = {
    kind: 'file' | 'folder';
    id: number;
    name: string;
};
export default function Home() {
    const { t, language, setLanguage, setTheme } = useLocale();
    const locale = language === 'th' ? 'th-TH' : 'en-US';
    const date = (v: string) => new Date(v).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const dateTime = (v: string) => new Date(v).toLocaleString(locale);
    const [sort, setSort] = useState('modified-desc'), [syncing, setSyncing] = useState(false), [offline, setOffline] = useState(false), [undoIds, setUndoIds] = useState<number[]>([]);
    const useTabLabel = (label: string) => t(label);
    const queue = useRef<UploadManagerRef>(null), appliedPreferences = useRef<number | null>(null);
    const [preferencesReady, setPreferencesReady] = useState(false), [advanced, setAdvanced] = useState(emptySearchFilters);
    const [workspace, setWorkspace] = useState<Workspace | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
    const [filePage,setFilePage]=useState(1);
    const [adminSection, setAdminSection] = useState<string | null>(null), [nav, setNav] = useState('My Files'), [filter, setFilter] = useState('All'), [query, setQuery] = useState('');
    const [searchIds, setSearchIds] = useState<number[] | null>(null), [searching, setSearching] = useState(false);
    const [folderId, setFolderId] = useState<number | null>(null), [selectedId, setSelectedId] = useState<number | null>(null), [details, setDetails] = useState<FileDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false), [detailError, setDetailError] = useState(''), [revision, setRevision] = useState(0), [tab, setTab] = useState('Overview');
    const [panel, setPanel] = useState<'details' | null>(null), [grid, setGrid] = useState(false), [ascending, setAscending] = useState(false), [checked, setChecked] = useState<number[]>([]);
    const [notice, setNotice] = useState<{
        text: string;
        error?: boolean;
    } | null>(null), [busy, setBusy] = useState(false), busyRef = useRef(false);
    const [mobile, setMobile] = useState(false), [modal, setModal] = useState<string | null>(null), [field, setField] = useState(''), [color, setColor] = useState('yellow');
    const [targetFolder, setTargetFolder] = useState<FolderItem | null>(null), [shareTarget, setShareTarget] = useState<ShareTarget | null>(null), [shares, setShares] = useState<Share[]>([]), [shareLoading, setShareLoading] = useState(false), [permission, setPermission] = useState<'viewer' | 'editor'>('viewer');
    const [progress, setProgress] = useState<{
        name: string;
        percent: number;
        index: number;
        total: number;
    } | null>(null), [dragging, setDragging] = useState(false), dragDepth = useRef(0);
    const input = useRef<HTMLInputElement>(null), versionInput = useRef<HTMLInputElement>(null), search = useRef<HTMLInputElement>(null);
    // Desktop collapses the sidebar in place (remembered per device); tablet and mobile open it as a drawer.
    const [collapsed, setCollapsed] = useState(() => { try {
        return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
    }
    catch {
        return false;
    } });
    const [drawerMode, setDrawerMode] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(DRAWER_QUERY).matches);
    const menuButton = useRef<HTMLButtonElement>(null), sidebarRef = useRef<HTMLElement>(null), drawerWasOpen = useRef(false);
    const sidebarOpen = drawerMode ? mobile : !collapsed;
    const refresh = useCallback(async () => {
        setSyncing(true);
        try {
            const data = await api<Workspace>('/api/workspace', { signal: AbortSignal.timeout(20000) });
            setWorkspace(data);
            setOffline(false);
            setLoadError('');
            setRevision(n => n + 1);
            setChecked(prev => prev.filter(id => data.files.some(f => f.id === id)));
        }
        catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                setWorkspace(null);
                setSelectedId(null);
                setDetails(null);
            }
            else {
                setLoadError(err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'Workspace loading timed out. Please try again.' : err instanceof Error ? err.message : 'Cannot connect to the server.');
                throw err;
            }
        }
        finally {
            setLoading(false);
            setSyncing(false);
        }
    }, []);
    useEffect(() => { void refresh().catch(() => { }); }, [refresh]);
    useEffect(() => { setAdminSection(new URLSearchParams(window.location.search).get('section')); }, []);
    useEffect(() => {
        const lost = () => setOffline(true), online = () => { setOffline(false); void refresh().catch(() => { }); };
        window.addEventListener('offline', lost);
        window.addEventListener('online', online);
        setOffline(!navigator.onLine);
        const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible')
            void refresh().catch(() => { }); }, 60000);
        return () => { clearInterval(timer); window.removeEventListener('offline', lost); window.removeEventListener('online', online); };
    }, [refresh]);
    useEffect(() => {
        if (!workspace)
            return;
        const focus = () => { void refresh().catch(() => { }); };
        window.addEventListener('focus', focus);
        return () => window.removeEventListener('focus', focus);
    }, [!!workspace, refresh]);
    useEffect(() => {
        if (!panel || modal || !window.matchMedia('(max-width:700px)').matches)
            return;
        const previous = document.activeElement as HTMLElement | null;
        const panelElement = document.querySelector<HTMLElement>('.detail-panel');
        if (!panelElement)
            return;
        const oldOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusable = () => Array.from(panelElement.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')).filter(el => el.offsetParent !== null);
        focusable()[0]?.focus();
        const trap = (e: KeyboardEvent) => { if (e.key !== 'Tab')
            return; const elements = focusable(), first = elements[0], last = elements[elements.length - 1]; if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
        } };
        document.addEventListener('keydown', trap);
        return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', trap); previous?.focus(); };
    }, [panel, modal]);
    useEffect(() => {
        if (notice) {
            const timer = setTimeout(() => setNotice(null), notice.error ? 8000 : 4000);
            return () => clearTimeout(timer);
        }
    }, [notice]);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                search.current?.focus();
            }
            if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable))) {
                e.preventDefault();
                search.current?.focus();
            }
            if (e.key === 'Escape') {
                setMobile(false);
                if (!modal)
                    setPanel(null);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [modal]);
    useEffect(() => {
        const media = window.matchMedia?.(DRAWER_QUERY);
        if (!media)
            return;
        const update = () => {
            setDrawerMode(media.matches);
            if (!media.matches)
                setMobile(false);
        };
        update();
        media.addEventListener?.('change', update);
        return () => media.removeEventListener?.('change', update);
    }, []);
    useEffect(() => { try {
        localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
    }
    catch { } }, [collapsed]);
    useEffect(() => {
        if (!drawerMode)
            return;
        if (mobile)
            sidebarRef.current?.querySelector<HTMLElement>('.nav-item')?.focus();
        else if (drawerWasOpen.current && (sidebarRef.current?.contains(document.activeElement) || document.activeElement === document.body))
            menuButton.current?.focus();
        drawerWasOpen.current = mobile;
    }, [mobile, drawerMode]);
    useEffect(() => {
        if (!selectedId || !workspace?.files.some(f => f.id === selectedId)) {
            setDetails(null);
            return;
        }
        const abort = new AbortController();
        setDetailsLoading(true);
        setDetailError('');
        api<FileDetails>(`/api/files/${selectedId}`, { signal: abort.signal }).then(data => {
            if (!abort.signal.aborted)
                setDetails(data);
        }).catch(err => {
            if (!abort.signal.aborted) {
                setDetails(null);
                setDetailError(err.message);
            }
        }).finally(() => {
            if (!abort.signal.aborted)
                setDetailsLoading(false);
        });
        return () => abort.abort();
    }, [selectedId, revision]);
    useEffect(() => {
        if (!workspace || !query.trim()) {
            setSearchIds(null);
            setSearching(false);
            return;
        }
        const abort = new AbortController();
        setSearching(true);
        setSearchIds(null);
        const timer = setTimeout(() => {
            api<{
                ids: number[];
            }>(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: abort.signal }).then(data => {
                if (!abort.signal.aborted)
                    setSearchIds(data.ids);
            }).catch(err => {
                if (!abort.signal.aborted)
                    setNotice({ text: `Content search failed: ${err.message}`, error: true });
            }).finally(() => {
                if (!abort.signal.aborted)
                    setSearching(false);
            });
        }, 250);
        return () => { clearTimeout(timer); abort.abort(); };
    }, [query, revision, !!workspace]);
    const files = workspace?.files || [], folders = workspace?.folders || [], selected = files.find(f => f.id === selectedId) || null, currentFolder = folders.find(f => f.id === folderId), selectedDetails = details?.file.id === selectedId ? details : null;
    const visibleFiles = useMemo(() => files.filter(f => matchesAdvanced(f, advanced) && (nav === 'Trash' ? f.deleted : !f.deleted) && (nav !== 'Favorites' || f.favorite) && (nav !== 'Shared' || f.shared || f.permission !== 'owner') && (!folderId || f.folderId === folderId) && (filter === 'All' || (filter === 'Media' ? ['Video', 'Audio'].includes(f.type) : f.type === filterTypes[filter])) && (!query.trim() || (searchIds ? searchIds.includes(f.id) : `${f.name} ${f.tags.join(' ')} ${f.excerpt}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))).sort((a, b) => ascending ? a.name.localeCompare(b.name, locale) : sort === 'name-desc' ? b.name.localeCompare(a.name, locale) : sort === 'size-desc' ? b.bytes - a.bytes : sort === 'size-asc' ? a.bytes - b.bytes : sort === 'modified-asc' ? a.modified.localeCompare(b.modified) : b.modified.localeCompare(a.modified)), [files, nav, folderId, filter, query, searchIds, ascending, advanced, sort, locale]);
    const pageCount=Math.max(1,Math.ceil(visibleFiles.length/50));
    const currentPage=Math.min(filePage,pageCount);
    const pagedFiles=visibleFiles.slice((currentPage-1)*50,currentPage*50);
    useEffect(()=>setFilePage(1),[nav,folderId,filter,query,advanced,sort,ascending]);
    useEffect(()=>setFilePage(page=>Math.min(page,pageCount)),[pageCount]);

    useEffect(() => {
        if (!workspace) {
            appliedPreferences.current = null;
            setPreferencesReady(false);
            return;
        }
        if (appliedPreferences.current === workspace.user.id)
            return;
        appliedPreferences.current = workspace.user.id;
        const saved = workspace.preferences || {};
        if (saved.language)
            setLanguage(saved.language);
        if (saved.theme)
            setTheme(saved.theme);
        setGrid(!!saved.grid);
        setAscending(!!saved.ascending);
        setSort(saved.sort || 'modified-desc');
        setPreferencesReady(true);
    }, [workspace?.user.id]);
    useEffect(() => {
        if (!preferencesReady || !workspace)
            return;
        const timer = setTimeout(() => { void mutate('/api/preferences', 'PATCH', { grid, ascending, sort }).catch(fail); }, 500);
        return () => clearTimeout(timer);
    }, [grid, ascending, sort, preferencesReady, workspace?.user.id]);
    const duplicateGroups = useMemo(() => {
        const groups = new Map<string, FileItem[]>();
        for (const file of files.filter(f => !f.deleted))
            groups.set(file.hash, [...(groups.get(file.hash) || []), file]);
        return [...groups.values()].filter(g => g.length > 1);
    }, [files]);
    function fail(err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
            setWorkspace(null);
            setModal(null);
        }
        setNotice({ text: err instanceof Error ? err.message : 'Something went wrong. Please try again.', error: true });
    }
    const folderColorPicker = (value: string, pick: (color: string) => void) => <div className="folder-color-picker" role="radiogroup" aria-label={t("Folder color")}>{FOLDER_COLORS.map(c => <button type="button" key={c} role="radio" aria-checked={value === c} aria-label={t(folderColorNames[c])} title={t(folderColorNames[c])} className={`folder-color-swatch ${c}`} disabled={busy} onClick={() => pick(c)}>{value === c && <Check size={14} strokeWidth={3}/>}</button>)}</div>;
    async function act(job: () => Promise<unknown>, message?: string, close = true) {
        if (busyRef.current)
            return;
        busyRef.current = true;
        setBusy(true);
        try {
            await job();
            await refresh();
            if (message)
                setNotice({ text: message });
            if (close)
                setModal(null);
        }
        catch (err) {
            fail(err);
        }
        finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    async function downloadZip() {
        const res = await fetch('/api/files/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: checked }) });
        if (!res.ok)
            throw new ApiError((await res.json().catch(() => ({}))).error || 'The ZIP could not be created.', res.status);
        const url = URL.createObjectURL(await res.blob()), link = document.createElement('a');
        link.href = url;
        link.download = 'nexafile.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    function openAdmin(section: string | null) {
        setAdminSection(section);
        window.history.replaceState(null, '', section ? `/?section=${encodeURIComponent(section)}` : '/');
        setPanel(null);
        setMobile(false);
    }
    function changeNav(name: string) {
        openAdmin(null);
        setAdvanced(emptySearchFilters);
        setNav(name);
        setFolderId(null);
        setFilter('All');
        setChecked([]);
        setQuery('');
        setMobile(false);
    }
    function toggleSidebar() {
        if (drawerMode)
            setMobile(open => !open);
        else
            setCollapsed(value => !value);
    }
    function openFile(file: FileItem) { setSelectedId(file.id); setPanel('details'); setTab('Overview'); }
    function openDialog(kind: string, value = '') { setField(value); setModal(kind); }
    async function updateFile(id: number, changes: Partial<FileItem> | {
        folderId: number | null;
    }) { await mutate(`/api/files/${id}`, 'PATCH', changes); if ('deleted' in changes && changes.deleted)
        setUndoIds([id]); }
    async function bulk(changes: {
        folderId?: number | null;
        deleted?: boolean;
    }) { const ids = checked.length ? checked : selected ? [selected.id] : []; await mutate('/api/files/bulk', 'PATCH', { items: ids.map(id => ({ id, changes })) }); if (changes.deleted)
        setUndoIds(ids); }
    async function shareWith(target: ShareTarget) {
        setShareTarget(target);
        setShares([]);
        setShareLoading(true);
        openDialog('sharing');
        try {
            const result = await api<{
                shares: Share[];
            }>(`/api/${target.kind === 'file' ? 'files' : 'folders'}/${target.id}/shares`);
            setShares(result.shares);
        }
        catch (err) {
            fail(err);
        }
        finally {
            setShareLoading(false);
        }
    }
    async function uploadFiles(list: File[], destination: number | null = folderId, versionFor?: number) {
        if (!list.length || !workspace)
            return;
        try {
            await queue.current?.add(list, destination, versionFor);
        }
        catch (err) {
            fail(err);
        }
    }
    async function dropInto(e: React.DragEvent, destination: number | null) {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        dragDepth.current = 0;
        if (e.dataTransfer.files.length) {
            await uploadFiles(Array.from(e.dataTransfer.files), destination);
            return;
        }
        const data = e.dataTransfer.getData('application/x-nexafile');
        if (!data)
            return;
        try {
            const ids: unknown = JSON.parse(data);
            if (!Array.isArray(ids) || !ids.every(id => Number.isSafeInteger(id) && files.some(f => f.id === id && f.permission === 'owner')))
                throw new Error('Only files you own can be moved.');
            await act(() => mutate('/api/files/bulk', 'PATCH', { items: ids.map(id => ({ id, changes: { folderId: destination } })) }), 'Files moved. Destination folder permissions now apply.', false);
        }
        catch (err) {
            fail(err);
        }
    }
    async function logout() {
        if (busy)
            return;
        try {
            await mutate('/api/auth/logout', 'POST');
            setWorkspace(null);
            setModal(null);
            setSelectedId(null);
            setDetails(null);
            setQuery('');
            setFolderId(null);
            setNav('My Files');
            setChecked([]);
            setPanel(null);
        }
        catch (err) {
            fail(err);
        }
    }
    if (loading)
        return <main className="workspace-skeleton" aria-busy="true"><header><BrandIcon size={32}/><strong>{t("NexaFile")}</strong><span role="status">{t('Opening your workspace…')}</span></header><div className="skeleton-layout"><aside className="skeleton-block"/><section><div className="skeleton-block skeleton-heading"/><div className="skeleton-row">{[1, 2, 3].map(i => <div className="skeleton-block" key={i}/>)}</div>{[1, 2, 3, 4].map(i => <div key={i} className="skeleton-block skeleton-line"/>)}<p>{t('Checking your session and loading files…')}</p><button className="text-button" onClick={() => window.location.reload()}>{t('Try again')}</button></section></div></main>;
    if (!workspace)
        return loadError ? <div className="app-loading"><Cloud size={32}/><h2>{t("Couldn\u2019t reach your workspace")}</h2><p>{t(loadError)}</p><button className="primary-button" onClick={() => { setLoading(true); void refresh().catch(() => { }); }}>{t("Try again")}</button></div> : <AuthForm onSuccess={refresh}/>;
    const user = workspace.user, adminTabs = adminSections(user.role), activeAdmin = adminSection && adminTabs.length ? (adminTabs.includes(adminSection) ? adminSection : adminTabs[0]) : null, percentage = Math.min(100, workspace.used / workspace.quota * 100), canUpload = !currentFolder || currentFolder.permission !== 'viewer', activeFolders = folders.filter(f => nav !== 'Shared' || f.shared || f.permission !== 'owner'), ownerFiles = files.filter(f => f.ownerId === user.id && !f.deleted);
    const categories = [{ name: 'Documents', types: ['Document', 'PDF', 'Spreadsheet', 'Presentation'], color: '#3884ff' }, { name: 'Images', types: ['Image'], color: '#31c8a2' }, { name: 'Media', types: ['Video', 'Audio'], color: '#ffc57e' }, { name: 'Other', types: ['Other'], color: '#ae8bfa' }].map(c => ({ ...c, bytes: ownerFiles.filter(f => c.types.includes(f.type)).reduce((n, f) => n + f.bytes, 0) }));
    const storageLevel = percentage >= 90 ? 'full' : percentage >= 75 ? 'warning' : 'ok';
    // Storage dialog rows: file types, then versions/trash, then other department members. Empty rows are hidden.
    const storageRows = [...categories.map(c => ({ name: t(c.name), bytes: c.bytes, color: c.color })), { name: t('Previous versions & Trash'), bytes: Math.max(0, (workspace.personalUsed ?? workspace.used) - categories.reduce((n, c) => n + c.bytes, 0)), color: '#9aa7bb' }, ...(workspace.user.department && workspace.personalUsed !== undefined ? [{ name: t('Other members of {department}', { department: workspace.user.department }), bytes: Math.max(0, workspace.used - workspace.personalUsed), color: '#c6d0e0' }] : [])].filter(r => r.bytes > 0);
    return <div className={`workspace${!drawerMode && collapsed ? ' sidebar-collapsed' : ''}`} onDragEnter={e => {
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                dragDepth.current++;
                setDragging(true);
            }
        }} onDragLeave={e => {
            if (e.dataTransfer.types.includes('Files')) {
                dragDepth.current--;
                if (dragDepth.current <= 0)
                    setDragging(false);
            }
        }} onDragOver={e => e.preventDefault()} onDrop={e => void dropInto(e, canUpload ? folderId : null)}>
    {dragging && <div className="drop-overlay"><Upload size={42}/><h2>{t("Drop files to upload")}</h2><p>{t("Save to")} {canUpload ? currentFolder?.name || 'Unfiled' : 'Unfiled'} {t("\u00B7 Up to")} {formatBytes(workspace.maxUpload)} {t("per file")}</p></div>}
    {drawerMode && mobile && <button className="sidebar-scrim" aria-label={t("Close navigation")} onClick={() => setMobile(false)}/>}
    <aside id="app-sidebar" ref={sidebarRef} inert={!sidebarOpen} className={`sidebar ${drawerMode && mobile ? 'mobile-open' : ''}`}><a className="brand" href="/" aria-label={t("NexaFile home")}><BrandIcon size={32}/><span>{t("NexaFile")}</span></a><nav>{navigation.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${nav === name && !activeAdmin ? 'active' : ''}`} onClick={() => changeNav(name)}><Icon size={21}/><span>{t(name)}</span>{name === 'Shared' && <span className="nav-count">{files.filter(f => f.shared && !f.deleted).length}</span>}</button>)}{adminTabs.length > 0 && <div className="sidebar-admin" role="group" aria-label={t('Admin panel')}><h4><ShieldCheck size={14}/>{t(user.role === 'super_admin' ? 'Super Admin' : 'Admin Department')}</h4>{adminTabs.map(name => { const Icon = sectionIcons[name]; return <button key={name} className={`nav-item ${activeAdmin === name ? 'active' : ''}`} aria-current={activeAdmin === name ? 'page' : undefined} onClick={() => openAdmin(name)}><Icon size={19}/><span>{t(name)}</span></button>; })}</div>}</nav><div className="sidebar-bottom"><div className="storage-small"><div className="storage-label"><strong>{t(workspace.user.department ? "Department storage" : "Storage")}</strong><Cloud size={16}/></div><p>{formatBytes(workspace.used)} {t("of")} {formatBytes(workspace.quota)} {t("used")}</p><div className="storage-line"><div className="progress"><i style={{ width: `${percentage}%` }}/></div><span>{percentage.toFixed(1)}{t("%")}</span></div><button className="upgrade-button" onClick={() => openDialog('storage')}><HardDrive size={15}/>{t("Manage storage")}</button></div><div className="ai-promo"><span className="promo-icon"><ShieldCheck size={19}/></span><div><strong>{t("Your work, safely saved")}</strong><p>{t("Files and every version are stored in your private server workspace.")}</p><button onClick={() => openDialog('profile')}>{t("Workspace details")}<ArrowRight size={14}/></button></div></div><div className={`workspace-status ${offline || loadError ? 'connection-error' : ''}`} role="status"><i />{t(offline ? 'Offline' : loadError ? 'Connection interrupted' : busy ? 'Saving changes…' : syncing ? 'Syncing…' : 'Workspace up to date')}<span>{t("v.2.0")}</span></div></div></aside>
    <div className="main-shell" inert={drawerMode && mobile}><header className="topbar"><button ref={menuButton} type="button" className="icon-button sidebar-toggle" aria-label={t(sidebarOpen ? "Close navigation" : "Open navigation")} aria-expanded={sidebarOpen} aria-controls="app-sidebar" onClick={toggleSidebar}><Menu size={22}/></button><div className="search-box">{searching ? <LoaderCircle size={18} className="spin"/> : <Search size={20}/>}<input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Search file names, tags, or document content...")} aria-label={t("Search files")}/><kbd>{t("Ctrl / \u2318 K")}</kbd></div><div className="topbar-actions"><LanguageSwitcher /><button className="icon-button settings-trigger" aria-label={t("Settings")} onClick={() => openDialog('settings')}><Settings2 size={18}/></button><button className="upload-button" aria-label={t("Upload")} disabled={busy || !canUpload} onClick={() => input.current?.click()}><Upload size={17}/><span>{t("Upload")}</span><i /><ChevronDown size={15}/></button><button className="notification-button icon-button" aria-label={t("Notifications")} onClick={() => openDialog('notifications')}><Bell size={21}/></button><div className="header-divider"/><button className="profile" aria-label={t('Account: {name}',{name:user.name})} onClick={() => openDialog('profile')}><Avatar name={user.name}/><span><strong>{user.name}</strong><small>{user.role === 'super_admin' ? t('Super Admin') : user.role === 'department_admin' ? t('Admin Department') : t('Personal Workspace')}</small></span><ChevronDown size={15}/></button></div></header>
    <input ref={input} type="file" multiple className="hidden-input" onChange={e => { const list = Array.from(e.target.files || []); e.target.value = ''; void uploadFiles(list); }}/><input ref={versionInput} type="file" className="hidden-input" onChange={e => {
            const list = Array.from(e.target.files || []);
            e.target.value = '';
            if (selected)
                void uploadFiles(list, null, selected.id);
        }}/>
    <div className={`content-layout ${panel ? '' : 'panel-closed'}`}><main className="main-content">{user.demo && <div className="demo-workspace-note"><ShieldCheck size={17}/><span>{t('Demo workspace')}{" "}{t("\u00B7")}{" "}{t(user.role || 'user')}{" "}{t("\u00B7")}{" "}{user.department}</span></div>}{loadError && <div className="inline-error" role="alert">{t(loadError)}<button onClick={() => void refresh().catch(fail)}>{t("Retry")}</button></div>}{activeAdmin ? <AdminPanel section={activeAdmin}/> : <><div className={`dashboard-top ${nav !== 'My Files' ? 'compact-dashboard' : ''}`}><div className="welcome-and-tools"><div className="welcome"><div className="eyebrow">{t("YOUR PERSONAL WORKSPACE")}</div><h1>{nav === 'My Files' ?t(new Date().getHours()<12?'Good morning, {name}':new Date().getHours()<18?'Good afternoon, {name}':'Good evening, {name}',{name:user.name.split(' ')[0]}) : t(nav)}</h1><p>{t(nav === 'Trash' ? 'Restore deleted files whenever you need them.' : 'Your files, organized and easy to find.')}</p></div><div className="feature-icons">{[{ title: 'Content Search', text: t('Search inside your documents, not just names.'), icon: Search, color: 'blue', count: 0, action: () => search.current?.focus() }, { title: 'Duplicate Detection', text: t('{count} duplicate groups found by file contents.',{count:duplicateGroups.length}), icon: Copy, color: 'purple', count: duplicateGroups.length, action: () => openDialog('duplicates') }, { title: 'Storage Usage', text: t('{used} of {total} used ({percent}%)',{used:formatBytes(workspace.used),total:formatBytes(workspace.quota),percent:percentage.toFixed(1)}), icon: HardDrive, color: 'green', count: 0, meter: percentage, action: () => openDialog('storage') }].map(({ title, text, icon: Icon, color, count, action, meter }: { title: string; text: string; icon: typeof Search; color: string; count: number; action: () => void; meter?: number }) => <button type="button" className="feature-icon-button" key={title} aria-label={t(title)} aria-description={text} title={`${t(title)} — ${text}`} onClick={action}><span className={`feature-icon ${color}`}><Icon size={20}/></span>{count > 0 && <span className="feature-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}{meter !== undefined && <span className={`feature-meter ${storageLevel}`} aria-hidden="true"><i style={{ width: `${Math.max(meter, 3)}%` }}/></span>}</button>)}</div></div></div>
    {nav !== 'Trash' && <section className="folders-section"><div className="section-heading"><h2>{t("Folders")}<span className="section-count">{activeFolders.length}</span></h2><button className="text-button" disabled={busy} onClick={() => { setColor('yellow'); openDialog('new-folder'); }}><Plus size={15}/>{t("New folder")}</button></div><div className="folder-grid">{activeFolders.map(f => <div key={f.id} className={`folder-card ${folderId === f.id ? 'chosen' : ''}`} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => void dropInto(e, f.id)}><button className="folder-open" onClick={() => { setFolderId(folderId === f.id ? null : f.id); setChecked([]); }}><span className={`folder-shape ${f.color}`}/><strong>{f.name}</strong><span>{f.count} {t(f.count === 1 ? 'file' : 'files')}</span></button><button className="folder-more icon-button" aria-label={t('Manage folder {name}',{name:f.name})} onClick={() => { setTargetFolder(f); openDialog('folder-actions'); }}><Ellipsis size={19}/></button>{f.shared && <Users size={14} className="shared-folder"/>}</div>)}</div></section>}
    <section className="files-section"><nav className="file-breadcrumb" aria-label={t('Location')}><button onClick={() => { setFolderId(null); setChecked([]); }}><House size={15}/>{t(nav)}</button>{currentFolder && <><span>{t("/")}</span><span aria-current="location">{currentFolder.name}</span></>}</nav><AdvancedSearch files={files} value={advanced} onChange={setAdvanced}/><div className="section-heading file-section-heading"><h2>{currentFolder ? <><FolderOpen size={19}/>{currentFolder.name}<button className="icon-button" aria-label={t("Clear folder filter")} onClick={() => setFolderId(null)}><X size={14}/></button></> : t(nav === 'Trash' ? 'Deleted Files' : 'Files')}<span className="file-count">{visibleFiles.length} {t("files")}</span></h2><div className="file-controls"><button className="icon-button" aria-label={t("Refresh workspace")} disabled={busy} onClick={() => void refresh().then(() => setNotice({ text: 'Workspace refreshed.' })).catch(fail)}><RefreshCw size={15}/></button><label className="sort-select"><ArrowUpDown size={14}/><span className="sr-only">{t('Sort files')}</span><select value={ascending ? 'name-asc' : sort} onChange={e => { setAscending(e.target.value === 'name-asc'); setSort(e.target.value); }}>{['modified-desc', 'modified-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc'].map((v, i) => <option value={v} key={v}>{t(['Last modified', 'Oldest first', 'Name A–Z', 'Name Z–A', 'Largest first', 'Smallest first'][i])}</option>)}</select></label><div className="view-toggle"><button className={!grid ? 'active' : ''} aria-pressed={!grid} aria-label={t("Table view")} onClick={() => setGrid(false)}><LayoutList size={16}/></button><button className={grid ? 'active' : ''} aria-pressed={grid} aria-label={t("Grid view")} onClick={() => setGrid(true)}><Grid2X2 size={16}/></button></div></div></div><div className="filter-row">{filters.map(f => <button className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => { setFilter(f); setChecked([]); }} key={f}>{t(f)}</button>)}</div>
    {(query.trim() || filter !== 'All' || Object.values(advanced).some(Boolean)) && <div className="active-filters"><span role="status">{visibleFiles.length} {t('results')}</span>{query && <span>{t("\u201C")}{query}{t("\u201D")}</span>}{filter !== 'All' && <span>{t(filter)}</span>}{Object.entries(advanced).filter(([, v]) => v).map(([key, value]) => <span key={key}>{t(({ owner: 'Owner', after: 'Modified after', before: 'Modified before', min: 'Minimum size (MB)', max: 'Maximum size (MB)' } as Record<string, string>)[key])}{t(":")}{key === 'owner' ? files.find(f => String(f.ownerId) === value)?.ownerName : value}</span>)}<button className="text-button" onClick={() => { setQuery(''); setFilter('All'); setAdvanced(emptySearchFilters); }}>{t('Clear filters')}</button></div>}
    {query.trim() && <div className="search-caption"><span>{t(searching ? 'Searching indexed document content…' : 'Searching names, tags, and indexed document content')}</span></div>}
    {currentFolder?.permission === 'viewer' && <div className="info-note">{t("You have view-only access to this shared folder.")}</div>}
    {checked.length > 0 && <div className="selection-bar"><span>{checked.length} {t("selected")}</span><button disabled={busy || checked.some(id => files.find(f => f.id === id)?.permission !== 'owner')} onClick={() => void act(async () => { await bulk({ deleted: nav !== 'Trash' }); setChecked([]); }, nav === 'Trash' ? 'Files restored.' : 'Files moved to Trash.')}>{t(nav === 'Trash' ? 'Restore' : 'Move to Trash')}<Trash2 size={14}/></button><button disabled={busy || checked.some(id => files.find(f => f.id === id)?.permission !== 'owner')} onClick={() => openDialog('move', currentFolder ? String(currentFolder.id) : '')}>{t("Move")}<FolderOpen size={14}/></button>{nav !== 'Trash' && <button disabled={busy} onClick={() => void act(downloadZip, 'ZIP download started.', false)}>{t("Download ZIP")}<Download size={14}/></button>}<button onClick={() => setChecked([])}>{t("Cancel")}</button></div>}
    <div className={grid ? 'file-cards' : 'table-wrap'}>{grid ? pagedFiles.map(f => <div className="file-tile-wrap" key={f.id}><input type="checkbox" aria-label={t('Select {name}',{name:f.name})} checked={checked.includes(f.id)} onChange={e => setChecked(prev => e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id))}/><button className={`file-tile ${selectedId === f.id ? 'selected' : ''}`} draggable={f.permission === 'owner'} onDragStart={e => e.dataTransfer.setData('application/x-nexafile', JSON.stringify(checked.includes(f.id) ? checked : [f.id]))} onClick={() => openFile(f)}><FileIcon type={f.type}/><strong>{f.name}</strong><span>{f.size}{" "}{t("\u00B7")}{" "}{f.folder}</span><div className="tags">{f.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div></button></div>) : <table><thead><tr><th className="check-cell"><input type="checkbox" aria-label={t("Select all visible files")} checked={visibleFiles.length > 0 && pagedFiles.every(f => checked.includes(f.id))} onChange={e => setChecked(previous => e.target.checked ? [...new Set([...previous,...pagedFiles.map(f=>f.id)])] : previous.filter(id=>!pagedFiles.some(f=>f.id===id)))}/></th><th><button onClick={() => { setAscending(!ascending); setSort('name-desc'); }}>{t("Name")}<ArrowDown size={13}/></button></th><th>{t("Tags")}</th><th>{t("Type")}</th><th><button onClick={() => { setAscending(false); setSort('modified-desc'); }}>{t("Modified")}<ArrowDown size={13}/></button></th><th>{t("Size")}</th><th /></tr></thead><tbody>{pagedFiles.map(f => <tr key={f.id} className={selectedId === f.id && panel === 'details' ? 'selected-row' : ''} onClick={() => openFile(f)} draggable={f.permission === 'owner'} onDragStart={e => e.dataTransfer.setData('application/x-nexafile', JSON.stringify(checked.includes(f.id) ? checked : [f.id]))}><td className="check-cell" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={t('Select {name}',{name:f.name})} checked={checked.includes(f.id)} onChange={e => setChecked(prev => e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id))}/></td><td><button className="file-name" onClick={() => openFile(f)}><FileIcon type={f.type}/><span title={f.name}>{f.name}</span>{f.favorite && <Star size={11} className="favorite-mark" fill="currentColor"/>}{f.permission !== 'owner' && <Users size={11} className="muted"/>}</button></td><td><div className="tags">{f.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}{f.tags.length > 3 && <span>{t("+")}{f.tags.length - 3}</span>}</div></td><td className="muted">{t(f.type)}</td><td className="muted modified-cell" title={dateTime(f.modified)}>{date(f.modified)}</td><td className="muted size-cell">{f.size}</td><td><button className="icon-button row-more" aria-label={t('Options for {name}',{name:f.name})} onClick={e => { e.stopPropagation(); openFile(f); openDialog('file'); }}><Ellipsis size={17}/></button></td></tr>)}</tbody></table>}</div>
    {visibleFiles.length === 0 && <div className="empty-state"><FolderOpen size={36}/><h3>{t(query || filter !== 'All' || Object.values(advanced).some(Boolean) ? 'No matching files' : nav === 'Trash' ? 'Your trash is empty' : nav === 'Favorites' ? 'No favorites yet' : nav === 'Shared' ? 'No shared files yet' : 'Room for your next idea')}</h3><p>{t(query || filter !== 'All' || Object.values(advanced).some(Boolean) ? 'Try another word or clear your filters.' : nav === 'Trash' ? 'Deleted files will appear here for recovery.' : nav === 'Favorites' ? 'Star a file to find it here.' : nav === 'Shared' ? 'Files shared with you will appear here.' : 'Upload your first file, or drag it into this workspace.')}</p>{query || filter !== 'All' || folderId || Object.values(advanced).some(Boolean) ? <button className="text-button" onClick={() => { setQuery(''); setFilter('All'); setFolderId(null); setAdvanced(emptySearchFilters); }}>{t("Clear filters")}<ArrowRight size={15}/></button> : nav !== 'Trash' && <button className="text-button" disabled={busy || !canUpload} onClick={() => input.current?.click()}><Upload size={15}/>{t("Upload a file")}</button>}</div>}{pageCount>1 && <nav className="file-pagination" aria-label={t('File pages')}><button type="button" disabled={currentPage===1} onClick={()=>setFilePage(currentPage-1)}>{t('Previous page')}</button><span role="status">{t('Page {page} of {total}',{page:currentPage,total:pageCount})}</span><button type="button" disabled={currentPage===pageCount} onClick={()=>setFilePage(currentPage+1)}>{t('Next page')}</button></nav>}<div className="file-footer"><span>{visibleFiles.length} {t("files \u00B7 Drag files into a folder to move")}</span><span><ShieldCheck size={13}/>{t("Secure & private")}</span></div></section></>}</main>
    {panel === 'details' && <aside className="detail-panel"><div className="detail-title">{selected && <FileIcon type={selected.type}/>}<h3>{selected?.name || 'File details'}</h3><button className="icon-button" aria-label={t("Close details")} onClick={() => setPanel(null)}><X size={18}/></button></div>{detailsLoading ? <div className="detail-loading"><LoaderCircle className="spin" size={24}/><p>{t("Loading file details\u2026")}</p></div> : detailError ? <div className="inline-error" role="alert">{t(detailError)}<button onClick={() => setRevision(n => n + 1)}>{t("Retry")}</button></div> : selectedDetails && selected ? <><div className="preview-container"><FilePreview details={selectedDetails}/><button className="expand-preview icon-button" aria-label={t("Expand preview")} onClick={() => openDialog('preview')}><Expand size={16}/></button></div><div className="detail-tabs">{['Overview', 'Content', 'Activity', 'Versions'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{useTabLabel(t)}</button>)}</div>
    {tab === 'Overview' ? <><dl className="file-metadata"><dt>{t("Type")}</dt><dd>{t(selected.type)}</dd><dt>{t("Size")}</dt><dd>{selected.size}</dd><dt>{t("Owner")}</dt><dd>{selected.ownerName}</dd><dt>{t("Location")}</dt><dd><button onClick={() => { setFolderId(selected.folderId); setNav('My Files'); setFilter('All'); }}><Folder size={15} className="green-text"/>{selected.folder}</button></dd><dt>{t("Modified")}</dt><dd>{dateTime(selected.modified)}</dd><dt>{t("Created")}</dt><dd>{date(selected.created)}</dd><dt>{t("Your access")}</dt><dd><span className={`permission-badge ${selected.permission}`}>{selected.permission}</span></dd><dt>{t("Sharing")}</dt><dd className="shared-with"><span>{t(selected.shared ? 'Shared workspace file' : 'Private')}</span>{selected.permission === 'owner' && <button className="text-button" onClick={() => void shareWith({ kind: 'file', id: selected.id, name: selected.name })}>{t("Manage")}</button>}</dd></dl><div className="detail-tag-section"><div className="section-heading"><h4>{t("Tags")}</h4>{selected.permission !== 'viewer' && <button className="text-button" disabled={busy} onClick={() => openDialog('tags', selected.tags.join(', '))}>{t("Edit")}</button>}</div><div className="tags">{selected.tags.length ? selected.tags.map(t => <button key={t} onClick={() => setQuery(t)}>{t}</button>) : <span>{t("No tags yet")}</span>}</div></div><FileTools key={selected.id} file={selected} scan={selectedDetails.scan} onDone={refresh} onError={text => setNotice({ text, error: true })}/></> : tab === 'Content' ? <div className="tab-content"><h3>{t("Indexed content")}</h3><div className="info-note">{t(selected.extractionStatus)}</div>{selectedDetails.text ? <pre className="indexed-content">{selectedDetails.text}</pre> : <p>{t("There is no extractable text in this file. Download it or use the media preview.")}</p>}</div> : tab === 'Activity' ? <div className="tab-content activity-list"><h3>{t("File activity")}</h3>{selectedDetails.activities.map(a => <p key={a.id}><span className="activity-dot"/>{t(a.action)}<small>{a.actor}{" "}{t("\u00B7")}{" "}{dateTime(a.created)}</small></p>)}</div> : <div className="tab-content"><div className="section-heading"><h3>{t("Version history")}</h3>{selected.permission !== 'viewer' && !selected.deleted && <button className="text-button" disabled={busy} onClick={() => versionInput.current?.click()}><Upload size={14}/>{t("New version")}</button>}</div>{selectedDetails.versions.map(v => <div className="version-row" key={v.id}><FileText size={19}/><span>{t("Version")}{v.number}<small>{dateTime(v.created)}{" "}{t("\u00B7")}{" "}{v.actor}<br />{formatBytes(v.bytes)}</small></span><div className="version-actions"><a className="icon-button" aria-label={t('Download version {number}',{number:v.number})} href={`${selected.url}?version=${v.id}&download=1`}><Download size={14}/></a>{v.current ? <span className="current-label">{t("Current")}</span> : selected.permission !== 'viewer' && !selected.deleted && <button disabled={busy} className="text-button" onClick={() => { setField(String(v.id)); setModal('restore-version'); }}>{t("Restore")}</button>}</div></div>)}</div>}
    <div className="suggested-actions"><h4>{t("File actions")}</h4><div><button type="button" className="file-actions-button" aria-haspopup="dialog" onClick={() => openDialog('file')}><Ellipsis size={18}/><span>{t("More file actions")}</span><ChevronRight size={16} className="file-actions-chevron"/></button></div></div><div className="detail-bottom"><button className="icon-button" disabled={busy} aria-label={t(selected.favorite ? 'Remove from favorites' : 'Add to favorites')} onClick={() => void act(() => updateFile(selected.id, { favorite: !selected.favorite }), undefined, false)}><Star size={18} fill={selected.favorite ? '#ffc45a' : 'none'} color={selected.favorite ? '#e6a52e' : 'currentColor'}/></button><span>{t("Version")}{selected.version}{" "}{t("\u00B7")}{" "}{t(selected.permission)} {t("access")}</span><a className="icon-button" aria-label={t("Download file")} href={`${selected.url}?download=1`}><Download size={18}/></a></div></> : <div className="empty-state"><FolderOpen size={30}/><p>{t("Select a file to view its details.")}</p></div>}</aside>}
    </div></div>
    <UploadManager ref={queue} userId={user.id} maxUpload={workspace.maxUpload} onDone={refresh} onError={text => setNotice({ text, error: true })}/>
    {progress && <div className="upload-progress" role="status"><div><Upload size={17}/><strong>{t("Uploading")} {progress.index}{t("of")} {progress.total}</strong><span>{progress.percent < 95 ? `${progress.percent}%` : 'Saving & indexing…'}</span></div><p>{progress.name}</p><div className="progress"><i style={{ width: `${progress.percent}%` }}/></div></div>}
    {undoIds.length > 0 && <div className="undo-banner" role="status"><Trash2 size={17}/><span>{undoIds.length} {t('files moved to Trash')}</span><button disabled={busy} onClick={() => void act(async () => { await mutate('/api/files/bulk', 'PATCH', { items: undoIds.map(id => ({ id, changes: { deleted: false } })) }); setUndoIds([]); }, 'Files restored.', false)}>{t('Undo')}</button><button className="icon-button" aria-label={t('Dismiss notification')} onClick={() => setUndoIds([])}><X size={16}/></button></div>}
    {notice && <div className={`toast ${notice.error ? 'error-toast' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? <X size={15}/> : <Check size={15}/>}</span>{t(notice.text)}<button aria-label={t("Dismiss notification")} onClick={() => setNotice(null)}><X size={14}/></button></div>}
    {modal && <Modal key={modal} title={modal === 'settings' ? 'Settings' : modal === 'links' ? 'Public links' : modal === 'new-folder' ? 'Create a folder' : modal === 'rename' ? 'Rename file' : modal === 'tags' ? 'Edit tags' : modal === 'move' ? 'Move files' : modal === 'folder-actions' ? targetFolder?.name || 'Folder' : modal === 'rename-folder' ? 'Rename folder' : modal === 'delete-folder' ? 'Delete empty folder?' : modal === 'sharing' ? 'Manage sharing' : modal === 'notifications' ? 'Workspace activity' : modal === 'profile' ? 'Your workspace' : modal === 'storage' ? 'Storage overview' : modal === 'duplicates' ? 'Duplicate files' : modal === 'preview' ? selected?.name || 'File preview' : modal === 'restore-version' ? 'Restore this version?' : modal === 'purge' ? 'Permanently delete file?' : selected?.name || 'File actions'} onClose={() => {
                if (!busy)
                    setModal(null);
            }} wide={['preview', 'duplicates', 'settings'].includes(modal)}>
    {['new-folder', 'rename', 'tags', 'move', 'rename-folder'].includes(modal) && <form className="dialog-form" onSubmit={e => {
                    e.preventDefault();
                    void act(async () => {
                        if (modal === 'new-folder')
                            await mutate('/api/folders', 'POST', { name: field, color });
                        else if (modal === 'rename-folder' && targetFolder)
                            await mutate(`/api/folders/${targetFolder.id}`, 'PATCH', { name: field });
                        else if (modal === 'rename' && selected)
                            await updateFile(selected.id, { name: field });
                        else if (modal === 'tags' && selected)
                            await updateFile(selected.id, { tags: field.split(',').map(t => t.trim()).filter(Boolean) });
                        else if (modal === 'move') {
                            await bulk({ folderId: field ? Number(field) : null });
                            setChecked([]);
                        }
                    }, modal === 'new-folder' ? 'Folder created.' : 'Changes saved.');
                }}><label>{t(modal === 'move' ? 'Destination folder' : modal === 'tags' ? 'Tags, separated by commas' : 'Name')}{modal === 'move' ? <select value={field} disabled={busy} onChange={e => setField(e.target.value)}><option value="">{t("Unfiled")}</option>{folders.filter(f => f.permission === 'owner').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select> : <input required={modal !== 'tags'} value={field} disabled={busy} maxLength={modal === 'tags' ? 600 : modal === 'rename' ? 180 : 80} onChange={e => setField(e.target.value)} placeholder={t(modal === 'tags' ? 'Design, Research, Q3' : 'Folder name')}/>}</label>{modal === 'move' && <div className="info-note">{t("Only files you own can be moved. Files inherit the sharing permissions of their destination folder.")}</div>}{modal === 'rename' && <p className="field-hint">{t("Keep the original file extension.")}</p>}{modal === 'new-folder' && <div className="folder-color-field"><span>{t("Folder color")}</span>{folderColorPicker(color, setColor)}</div>}<button className="primary-button" disabled={busy}>{t(busy ? 'Saving…' : modal === 'new-folder' ? 'Create folder' : 'Save changes')}</button></form>}
    {modal === 'settings' && <AccountSettings onSaved={refresh} onBusy={setBusy}/>}
    {modal === 'links' && selected && <PublicLinkManager fileId={selected.id}/>}
    {modal === 'file' && selected && <><p className="modal-description">{selected.size}{" "}{t("\u00B7")}{" "}{selected.permission} {t("access \u00B7 Version")} {selected.version}</p><div className="file-menu"><a href={`${selected.url}?download=1`}><Download size={18}/>{t("Download original")}</a><button disabled={busy} onClick={() => void act(() => updateFile(selected.id, { favorite: !selected.favorite }), selected.favorite ? 'Removed from favorites.' : 'Added to favorites.')}><Star size={18}/>{t(selected.favorite ? 'Remove from favorites' : 'Add to favorites')}</button>{selected.permission !== 'viewer' && <><button disabled={busy} onClick={() => openDialog('rename', selected.name)}><FileText size={18}/>{t("Rename file")}</button><button disabled={busy} onClick={() => openDialog('tags', selected.tags.join(', '))}><Tag size={18}/>{t("Edit tags")}</button>{!selected.deleted && <button disabled={busy} onClick={() => { setModal(null); versionInput.current?.click(); }}><Upload size={18}/>{t("Upload a new version")}</button>}</>}{selected.permission === 'owner' && <><button disabled={busy} onClick={() => { setChecked([]); openDialog('move', selected.folderId ? String(selected.folderId) : ''); }}><FolderOpen size={18}/>{t("Move to folder")}</button><button disabled={busy} onClick={() => void shareWith({ kind: 'file', id: selected.id, name: selected.name })}><Users size={18}/>{t("Manage sharing")}</button>{!selected.deleted && <button onClick={() => openDialog('links')}><Users size={18}/>{t('Create share link')}</button>}<button disabled={busy} onClick={() => void act(() => updateFile(selected.id, { deleted: !selected.deleted }), selected.deleted ? 'File restored.' : 'Moved to Trash. You can restore it anytime.')}><Trash2 size={18}/>{t(selected.deleted ? 'Restore from Trash' : 'Move to Trash')}</button>{selected.deleted && <button disabled={busy} onClick={() => openDialog('purge')}><Trash2 size={18}/>{t("Permanently delete")}</button>}</>}</div></>}
    {modal === 'folder-actions' && targetFolder && <><p className="modal-description">{targetFolder.count} {t("files \u00B7")} {targetFolder.permission} {t("access")}</p>{targetFolder.permission === 'owner' && <div className="folder-color-field"><span>{t("Folder color")}</span>{folderColorPicker(targetFolder.color, c => {
                    const folder = targetFolder;
                    if (c === folder.color) return;
                    setTargetFolder({ ...folder, color: c });
                    void act(async () => { try { await mutate(`/api/folders/${folder.id}`, 'PATCH', { color: c }); } catch (err) { setTargetFolder(folder); throw err; } }, 'Folder color changed.', false);
                })}</div>}<div className="file-menu"><button onClick={() => { setFolderId(targetFolder.id); setModal(null); }}><FolderOpen size={18}/>{t("Open folder")}</button>{targetFolder.permission === 'owner' && <><button disabled={busy} onClick={() => openDialog('rename-folder', targetFolder.name)}><FileText size={18}/>{t("Rename folder")}</button><button onClick={() => void shareWith({ kind: 'folder', id: targetFolder.id, name: targetFolder.name })}><Users size={18}/>{t("Manage folder sharing")}</button><button disabled={busy} onClick={() => openDialog('delete-folder')}><Trash2 size={18}/>{t("Delete empty folder")}</button></>}</div></>}
    {modal === 'delete-folder' && targetFolder && <><p className="modal-description">{t("Delete \u201C")}{targetFolder.name}{t("\u201D? Move all files out first, including files in Trash. Folder sharing will be removed.")}</p><button className="primary-button danger-button" disabled={busy} onClick={() => void act(async () => {
                    await mutate(`/api/folders/${targetFolder.id}`, 'DELETE');
                    if (folderId === targetFolder.id)
                        setFolderId(null);
                }, 'Empty folder deleted.')}>{t("Delete folder")}</button></>}
    {modal === 'purge' && selected && <form className="dialog-form" onSubmit={e => { e.preventDefault(); void act(async () => { await mutate(`/api/files/${selected.id}`, 'DELETE', { confirmName: field }); setSelectedId(null); setPanel(null); }, 'File and version history permanently deleted.'); }}><p className="modal-description">{t("This permanently deletes the file, sharing permissions, and every saved version. It cannot be restored through NexaFile.")}</p><label>{t("Type \u201C")}{selected.name}{t("\u201D to confirm")}<input value={field} onChange={e => setField(e.target.value)} autoComplete="off" disabled={busy}/></label><button className="primary-button danger-button" disabled={busy || field !== selected.name}>{t("Permanently delete file")}</button></form>}
    {modal === 'sharing' && shareTarget && <><p className="modal-description">{shareTarget.name}</p><div className="info-note">{t("Share with an existing NexaFile account. Folder access applies to every file inside. Viewers can preview and download; editors can also upload versions, rename files, and edit tags.")}</div><form className="dialog-form" onSubmit={e => {
                    e.preventDefault();
                    void act(async () => {
                        const result = await mutate<{
                            shares: Share[];
                        }>(`/api/${shareTarget.kind === 'file' ? 'files' : 'folders'}/${shareTarget.id}/shares`, 'POST', { email: field, permission });
                        setShares(result.shares);
                        setField('');
                    }, 'Sharing permissions saved.', false);
                }}><label>{t("Account email")}<AccountPicker value={field} onChange={setField} exclude={[user.email, ...shares.map(s => s.email)]} placeholder={t("Search by name or email")} disabled={busy || shareLoading}/></label><div className="share-form-row"><select aria-label={t("Sharing permission")} value={permission} onChange={e => setPermission(e.target.value as 'viewer' | 'editor')} disabled={busy}><option value="viewer">{t("Can view")}</option><option value="editor">{t("Can edit")}</option></select><button className="primary-button" disabled={busy || shareLoading}>{t("Grant access")}</button></div></form>{shareLoading ? <p className="field-hint">{t("Loading access list\u2026")}</p> : shares.length ? shares.map(s => <div className="collaborator" key={s.id}><Avatar name={s.name} small/><span><strong>{s.name}</strong><small>{s.email}{" "}{t("\u00B7")}{" "}{s.permission}</small></span><button className="text-button" disabled={busy} onClick={() => void act(async () => {
                        const result = await mutate<{
                            shares: Share[];
                        }>(`/api/${shareTarget.kind === 'file' ? 'files' : 'folders'}/${shareTarget.id}/shares?shareId=${s.id}`, 'DELETE');
                        setShares(result.shares);
                    }, 'Access revoked.', false)}>{t("Remove")}</button></div>) : <p className="field-hint">{t("No direct shares. This item is private unless folder permissions apply.")}</p>}{shareTarget.kind === 'file' && selectedDetails?.inheritedShares.length ? <div className="info-note">{t("Folder access:")}{selectedDetails.inheritedShares.map(s => `${s.name} (${s.permission})`).join(', ')}{t(". Manage the folder\u2019s sharing to revoke inherited access.")}</div> : null}</>}
    {modal === 'notifications' && <div className="notification-list">{workspace.activities.length ? workspace.activities.map(a => <div className="notification-item" key={a.id}><Clock3 size={18}/><span><strong>{t(a.action)}</strong>{a.fileName && <small>{a.fileName}</small>}<small>{a.actor}{" "}{t("\u00B7")}{" "}{dateTime(a.created)}</small></span></div>) : <p className="modal-description">{t("Your file activity will appear here.")}</p>}</div>}
    {modal === 'profile' && <><Avatar name={user.name}/><h3 className="profile-name">{user.name}</h3><p className="modal-description">{user.email}</p><div className="profile-details"><span><HardDrive size={17}/>{formatBytes(workspace.used)} {t("stored \u00B7")} {formatBytes(workspace.quota)} {t("quota")}</span><span><ShieldCheck size={17}/>{t("Password protected \u00B7 Private by default")}</span></div><button className="secondary-button" onClick={() => openDialog('settings')}>{t('Settings')}{t("/")}{t('Account security')}</button><button className="secondary-button logout-button" disabled={busy} onClick={() => void logout()}><LogOut size={17}/>{t("Sign out")}</button></>}
    {modal === 'storage' && <><div className={`storage-summary ${storageLevel}`}><div className="storage-summary-head"><div><strong>{formatBytes(workspace.used)}</strong><span>{t("used of {total}",{total:formatBytes(workspace.quota)})}</span></div><div className="storage-free"><strong>{formatBytes(Math.max(0, workspace.quota - workspace.used))}</strong><span>{t("free")}</span></div></div><div className="storage-meter" role="progressbar" aria-label={t("Storage used")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)}><i style={{ width: `${percentage}%` }}/></div><p className="storage-status">{storageLevel === 'ok' ? <Check size={16}/> : <AlertTriangle size={16}/>}<span>{t(storageLevel === 'full' ? 'Storage is almost full. Delete files you no longer need or empty Trash.' : storageLevel === 'warning' ? 'Storage is getting full.' : 'Plenty of space left.')} {t("{percent}% used",{percent:percentage.toFixed(1)})}</span></p></div><p className="modal-description">{workspace.user.department ? t("This space is shared by everyone in {department}.",{department:workspace.user.department}) : t("This space is for your account only.")}</p><h3 className="storage-heading">{t("What's using your space")}</h3>{storageRows.length ? <ul className="storage-list">{storageRows.map(r => <li key={r.name}><i className="storage-dot" style={{ background: r.color }}/><span className="storage-name">{r.name}</span><span className="storage-bar"><i style={{ width: `${workspace.used ? r.bytes / workspace.used * 100 : 0}%`, background: r.color }}/></span><strong>{formatBytes(r.bytes)}</strong></li>)}</ul> : <p className="field-hint">{t("Nothing stored yet.")}</p>}<div className="info-note">{t(workspace.user.department ? "All saved versions and trashed files count toward storage. Administrators set department storage in the admin panel. Upload limit:" : "All saved versions and trashed files count toward storage. Administrators can change your quota in the admin panel. Upload limit:")}{formatBytes(workspace.maxUpload)} {t("per file.")}</div></>}
    {modal === 'duplicates' && <><p className="modal-description">{t("Exact duplicates are identified from file contents, even if names differ. Only files you can access are compared.")}</p>{duplicateGroups.length ? <div className="duplicate-list">{duplicateGroups.map(group => <div className="duplicate-group" key={group[0].hash}><h4>{group.length} {t("identical files \u00B7")} {group[0].size} {t("each")}</h4>{group.map(f => <div key={f.id}><button onClick={() => { openFile(f); setModal(null); }}><FileIcon type={f.type}/><span>{f.name}<small>{f.folder}{" "}{t("\u00B7")}{" "}{f.ownerName}</small></span></button>{f.permission === 'owner' && <button className="icon-button" disabled={busy} aria-label={t('Move duplicate {name} to Trash',{name:f.name})} onClick={() => void act(() => updateFile(f.id, { deleted: true }), 'Duplicate moved to Trash.', false)}><Trash2 size={16}/></button>}</div>)}</div>)}</div> : <div className="empty-state"><Check size={30}/><h3>{t("No duplicate files")}</h3><p>{t("Your accessible files all have different contents.")}</p></div>}</>}
    {modal === 'preview' && selectedDetails && <><p className="modal-description">{selectedDetails.file.type}{" "}{t("\u00B7")}{" "}{selectedDetails.file.size}</p><FilePreview details={selectedDetails} expanded/><a className="text-button" href={`${selectedDetails.file.url}?download=1`}><Download size={15}/>{t("Download original")}</a></>}
    {modal === 'restore-version' && selected && <><p className="modal-description">{t("The selected content will become a new version. All existing versions remain available.")}</p><button className="primary-button" disabled={busy} onClick={() => void act(() => mutate(`/api/files/${selected.id}/versions`, 'PATCH', { versionId: Number(field) }), 'Version restored as a new version.')}>{t("Restore version")}</button></>}
    </Modal>}
  </div>;
}
