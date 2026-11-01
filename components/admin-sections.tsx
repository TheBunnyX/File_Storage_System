import { Building2, Database, FileClock, LayoutDashboard, Settings as SettingsIcon, Users, type LucideIcon } from 'lucide-react';

export const sectionIcons: Record<string, LucideIcon> = { 'Overview & services': LayoutDashboard, Members: Users, Departments: Building2, 'System settings': SettingsIcon, Backups: Database, 'Audit log': FileClock };

// Admin sections a role may open; demo super admins see every section read-only.
export function adminSections(role?: string) {
    if (role === 'super_admin')
        return ['Overview & services', 'Members', 'Departments', 'System settings', 'Backups', 'Audit log'];
    return role === 'department_admin' || role === 'admin' ? ['Members', 'Departments', 'Audit log'] : [];
}
