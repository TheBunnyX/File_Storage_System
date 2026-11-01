import { AsyncLocalStorage } from 'node:async_hooks';
import { WORKSPACE_INDEXES } from './db-indexes';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { mysqlEnabled, mysqlPool, mysqlQuery } from './mysql';
import { redisEnabled, redisRateLimit } from './redis';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const dataDirectory = path.resolve(/* turbopackIgnore: true */ process.env.NEXAFILE_DATA_DIR || path.join(process.cwd(), 'data'));
export const blobDirectory = path.join(dataDirectory, 'blobs');
let connection: DatabaseSync | undefined;
export function db() {
  if (connection) return connection;
  mkdirSync(blobDirectory, { recursive: true, mode: 0o700 });
  connection = new DatabaseSync(path.join(dataDirectory, 'nexafile.sqlite'));
  connection.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS folders(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, color TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(owner_id,name));
    CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL, name TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', type TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', extraction_status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, modified TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, number INTEGER NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, text TEXT NOT NULL, extraction_status TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), created TEXT NOT NULL, UNIQUE(file_id,number));
    CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, PRIMARY KEY(user_id,file_id));
    CREATE TABLE IF NOT EXISTS shares(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('file','folder')), resource_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL CHECK(permission IN ('viewer','editor')), UNIQUE(kind,resource_id,user_id));
    CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY, file_id INTEGER REFERENCES files(id) ON DELETE CASCADE, owner_id INTEGER NOT NULL REFERENCES users(id), actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS files_owner ON files(owner_id);
    CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id,kind,resource_id);
    CREATE INDEX IF NOT EXISTS activities_file ON activities(file_id);
    CREATE TABLE IF NOT EXISTS account_security(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email_verified INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user', blocked INTEGER NOT NULL DEFAULT 0, totp_secret TEXT, totp_pending TEXT, pending_expires INTEGER, totp_step INTEGER NOT NULL DEFAULT -1, recovery TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS auth_tokens(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, value TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS user_limits(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, quota_bytes INTEGER, ai_requests INTEGER NOT NULL DEFAULT 50, ai_tokens INTEGER NOT NULL DEFAULT 100000);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS upload_sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), owner_id INTEGER NOT NULL REFERENCES users(id), folder_id INTEGER, file_id INTEGER, name TEXT NOT NULL, size INTEGER NOT NULL, offset INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'uploading', lease INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL, result_id INTEGER);
    CREATE TABLE IF NOT EXISTS public_links(id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, owner_id INTEGER NOT NULL REFERENCES users(id), password TEXT, expires INTEGER NOT NULL, download INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS link_sessions(token_hash TEXT PRIMARY KEY, link_id INTEGER NOT NULL REFERENCES public_links(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blob_scans(hash TEXT PRIMARY KEY, status TEXT NOT NULL, checked TEXT NOT NULL);
    INSERT OR IGNORE INTO account_security(user_id) SELECT id FROM users;
    PRAGMA user_version=2;
  `);
  if (!(connection.prepare('PRAGMA table_info(upload_sessions)').all() as { name: string }[]).some(c => c.name === 'expected_hash')) connection.exec('ALTER TABLE upload_sessions ADD COLUMN expected_hash TEXT');
  connection.exec("CREATE TABLE IF NOT EXISTS account_profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, department TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0)");
  for(const index of WORKSPACE_INDEXES)connection.exec(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table}(${index.columns})`);
  return connection;
}
type TransactionContext = {connection?:PoolConnection; depth:number};
const context=new AsyncLocalStorage<TransactionContext>();
const queryMetrics=new AsyncLocalStorage<{count:number}>();
/** Opt-in diagnostics count database calls without retaining SQL or parameter values. */
export async function measureDatabaseQueries<T>(fn:()=>Promise<T>) {
 const metrics={count:0};
 const value=await queryMetrics.run(metrics,fn);
 return {value,queries:metrics.count};
}
let sqliteQueue=Promise.resolve();
async function sqliteLock<T>(fn:()=>Promise<T>|T):Promise<T>{
 if(context.getStore())return fn();
 const previous=sqliteQueue;let release!:()=>void;sqliteQueue=new Promise<void>(resolve=>release=resolve);await previous;
 try{return await fn()}finally{release()}
}
async function query(sql:string,values:SQLInputValue[],mode:'all'|'run'){
 const metrics=queryMetrics.getStore();if(metrics)metrics.count++;
 if(mysqlEnabled()){const result=await mysqlQuery(context.getStore()?.connection||await mysqlPool(),sql,values);if(mode==='all')return result as unknown[];const header=result as ResultSetHeader;return {changes:header.affectedRows,lastInsertRowid:header.insertId};}
 return sqliteLock(()=>mode==='all'?db().prepare(sql).all(...values):db().prepare(sql).run(...values));
}
export async function one<T>(sql:string,...values:SQLInputValue[]){return (await query(sql,values,'all') as T[])[0];}
export async function all<T>(sql:string,...values:SQLInputValue[]){return await query(sql,values,'all') as T[];}
export async function run(sql:string,...values:SQLInputValue[]){return await query(sql,values,'run') as {changes:number|bigint;lastInsertRowid:number|bigint};}
export async function transaction<T>(fn:()=>T|Promise<T>):Promise<T>{
 const parent=context.getStore();
 if(parent){const name='nexafile_'+(++parent.depth);const exec=async(sql:string)=>{if(parent.connection)await parent.connection.query(sql);else db().exec(sql)};await exec('SAVEPOINT '+name);try{const value=await fn();await exec('RELEASE SAVEPOINT '+name);return value}catch(error){await exec('ROLLBACK TO SAVEPOINT '+name);await exec('RELEASE SAVEPOINT '+name);throw error}finally{parent.depth--}}
 if(mysqlEnabled()){const connection=await(await mysqlPool()).getConnection();try{await connection.beginTransaction();return await context.run({connection,depth:0},async()=>{try{const value=await fn();await connection.commit();return value}catch(error){await connection.rollback();throw error}})}finally{connection.release()}}
 return sqliteLock(()=>context.run({depth:0},async()=>{db().exec('BEGIN IMMEDIATE');try{const value=await fn();db().exec('COMMIT');return value}catch(error){db().exec('ROLLBACK');throw error}}));
}
export async function asyncFilter<T>(values:T[],predicate:(value:T,index:number)=>boolean|Promise<boolean>):Promise<T[]>{const included=await Promise.all(values.map(predicate));return values.filter((_,index)=>included[index]);}
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function requireValue(condition: unknown, message: string, status = 400): asserts condition { if (!condition) throw new HttpError(status, message); }
export async function rateLimit(key: string, limit: number, period = 60_000) {
  if(redisEnabled()){if(!await redisRateLimit(key,limit,period))throw new HttpError(429,'Too many requests. Please try again shortly.');return;}
  const now = Date.now();
  await run('DELETE FROM rate_limits WHERE reset < ?', now);
  const current = await one<{ count: number; reset: number }>('SELECT * FROM rate_limits WHERE key=?', key);
  if (current && current.count >= limit) throw new HttpError(429, 'Too many requests. Please try again shortly.');
  await run('INSERT INTO rate_limits(key,count,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + period);
}
export function cleanName(value: unknown, max = 180) {
  requireValue(typeof value === 'string', 'A name is required.');
  const name = value.trim().normalize('NFC');
  requireValue(name.length > 0 && name.length <= max && !/[\\/\x00-\x1f\x7f]/.test(name) && name !== '.' && name !== '..', `Use a name of 1–${max} characters without slashes or control characters.`);
  return name;
}
export function positiveId(value: unknown) { const id = Number(value); requireValue(Number.isSafeInteger(id) && id > 0, 'Invalid ID.'); return id; }
