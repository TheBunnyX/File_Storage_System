import { asyncFilter } from './db';
import { one, run, transaction } from './db';
import { passwordHash } from './security';
const accounts = [
    { name: 'Somchai Rattanakul', email: 'superadmin@nexafile.demo', role: 'super_admin', department: 'Platform', label: 'Super Admin', description: 'Manage demo accounts across departments' },
    { name: 'Kanokwan Srisuk', email: 'department.admin@nexafile.demo', role: 'department_admin', department: 'Product', label: 'Admin Department', description: 'Manage demo users in the Product department' },
    { name: 'Narin Thongdee', email: 'user@nexafile.demo', role: 'user', department: 'Product', label: 'User', description: 'Upload, organize and share your own files' },
];
const password = 'NexaDemo!2026';
let preparing: Promise<void> | undefined;
export async function demoAccounts() {
    if (process.env.NEXAFILE_DEMO !== 'true')
        return [];
    preparing ??= (async () => {
        const hash = await passwordHash(password);
        (await transaction(async () => {
            for (const account of accounts) {
                // Never take ownership of an existing, non-demo account.
                if ((await one('SELECT id FROM users WHERE email=?', account.email)))
                    continue;
                const id = Number((await run('INSERT INTO users(name,email,password,created) VALUES(?,?,?,?)', account.name, account.email, hash, new Date().toISOString())).lastInsertRowid);
                (await run('INSERT INTO account_security(user_id,role,email_verified) VALUES(?,?,1)', id, account.role));
                (await run('INSERT INTO account_profiles(user_id,department,is_demo) VALUES(?,?,1)', id, account.department));
                (await run('INSERT INTO folders(owner_id,name,color,created) VALUES(?,?,?,?)', id, 'Demo workspace', 'blue', new Date().toISOString()));
            }
        }));
    })().catch(error => { preparing = undefined; throw error; });
    await preparing;
    return (await asyncFilter(accounts, async (account) => (await one('SELECT 1 FROM users u JOIN account_profiles p ON p.user_id=u.id WHERE u.email=? AND p.is_demo=1', account.email)))).map(account => ({ ...account, password }));
}
