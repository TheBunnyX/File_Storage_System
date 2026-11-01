import { cleanName, one, requireValue, run } from './db';
export type AppSettings = {
    registration: boolean;
    defaultQuotaMb: number;
    maxUploadMb: number;
    trashRetentionDays: number;
};
export const DEFAULT_DEPARTMENT_QUOTA = 10 * 1024 ** 3;
const MAX_QUOTA = 10995116277760;
async function stored(key: string) {
    return JSON.parse((await one<{
        value: string;
    }>('SELECT value FROM operations WHERE key=?', key))?.value || '{}');
}
// Values saved from the admin panel take precedence; .env remains the default.
export async function appSettings(): Promise<AppSettings> {
    const saved: Partial<AppSettings> = await stored('app-settings');
    const days = Number(process.env.NEXAFILE_TRASH_RETENTION_DAYS ?? 30);
    return {
        registration: saved.registration ?? process.env.DISABLE_REGISTRATION !== 'true',
        defaultQuotaMb: saved.defaultQuotaMb ?? Math.max(1, Number(process.env.NEXAFILE_QUOTA_MB) || 1024),
        maxUploadMb: saved.maxUploadMb ?? Math.min(100, Math.max(1, Number(process.env.NEXAFILE_MAX_UPLOAD_MB) || 50)),
        trashRetentionDays: saved.trashRetentionDays ?? (Number.isFinite(days) && days > 0 ? days : 0),
    };
}
export async function saveAppSettings(body: Record<string, unknown>) {
    requireValue(typeof body.registration === 'boolean', 'Invalid registration setting.');
    requireValue(Number.isSafeInteger(body.defaultQuotaMb) && Number(body.defaultQuotaMb) >= 1 && Number(body.defaultQuotaMb) * 1048576 <= MAX_QUOTA, 'Invalid default quota.');
    requireValue(Number.isSafeInteger(body.maxUploadMb) && Number(body.maxUploadMb) >= 1 && Number(body.maxUploadMb) <= 100, 'Choose an upload limit of 1–100 MB.');
    requireValue(Number.isSafeInteger(body.trashRetentionDays) && Number(body.trashRetentionDays) >= 0 && Number(body.trashRetentionDays) <= 3650, 'Choose 0–3,650 days for Trash retention.');
    const value: AppSettings = { registration: body.registration as boolean, defaultQuotaMb: body.defaultQuotaMb as number, maxUploadMb: body.maxUploadMb as number, trashRetentionDays: body.trashRetentionDays as number };
    (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('app-settings',?)", JSON.stringify(value)));
    return value;
}
export async function maxUploadBytes() { return (await appSettings()).maxUploadMb * 1048576; }
export async function departmentQuotas(): Promise<Record<string, number>> { return stored('department-quotas'); }
export async function departmentQuota(name: string) { return (await departmentQuotas())[name] ?? DEFAULT_DEPARTMENT_QUOTA; }
export function departmentName(value: unknown) { return cleanName(value, 80); }
export async function setDepartmentQuota(name: string, quota: number | null) {
    if (quota !== null)
        requireValue(Number.isSafeInteger(quota) && quota >= 1048576 && quota <= MAX_QUOTA, 'Invalid department storage.');
    const quotas = await departmentQuotas();
    if (quota === null)
        delete quotas[name];
    else
        quotas[name] = quota;
    (await run("INSERT OR REPLACE INTO operations(key,value) VALUES('department-quotas',?)", JSON.stringify(quotas)));
}
