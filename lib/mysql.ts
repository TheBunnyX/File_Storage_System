import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import { MYSQL_SCHEMA } from './mysql-schema';
import { WORKSPACE_INDEXES } from './db-indexes';

let pool: Pool | undefined;
let ready: Promise<void> | undefined;
export const mysqlEnabled = () => { const backend=process.env.DATABASE_BACKEND;if(backend&&!['mysql','sqlite'].includes(backend))throw new Error('Invalid DATABASE_BACKEND.');return backend==='mysql'; };
export async function mysqlPool() {
  if(!process.env.MYSQL_HOST||!process.env.MYSQL_USER||!process.env.MYSQL_DATABASE)throw new Error('MYSQL_HOST, MYSQL_USER and MYSQL_DATABASE are required.');
  pool ??= mysql.createPool({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 10, connectTimeout: 5000, enableKeepAlive: true, supportBigNumbers: true, decimalNumbers: true, charset: 'utf8mb4' });
  ready ??= (async () => {
    for (const sql of MYSQL_SCHEMA) await pool!.query(sql);
    const [rows]=await pool!.query<mysql.RowDataPacket[]>('SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=?',[process.env.MYSQL_DATABASE]);
    const existing=new Set(rows.map(row=>row.INDEX_NAME));
    for(const index of WORKSPACE_INDEXES)if(!existing.has(index.name)){
      try { await pool!.query(`CREATE INDEX ${index.name} ON ${index.table}(${index.columns})`); }
      catch(error){if((error as {code?:string}).code!=='ER_DUP_KEYNAME')throw error;}
    }
  })().catch(error => { ready = undefined; throw error; });
  await ready;
  return pool;
}
export function mysqlSQL(sql: string) {
  let value = sql.replace(/\bINSERT OR IGNORE INTO\b/gi, 'INSERT IGNORE INTO').replace(/\bIS \?/gi, '<=> ?').replace(/\bMAX\(0,/gi, 'GREATEST(0,');
  if (/INSERT OR REPLACE INTO/i.test(value)) {
    value = value.replace(/INSERT OR REPLACE INTO/i, 'INSERT INTO');
    const columns = value.match(/INSERT INTO \w+\(([^)]+)\)/i)?.[1].split(',').map(c => c.trim());
    if (!columns) throw new Error('Unsupported replace statement.');
    value += ' ON DUPLICATE KEY UPDATE ' + columns.map(c => `${c}=VALUES(${c})`).join(',');
  }
  value = value.replace(/ON CONFLICT\([^)]+\) DO UPDATE SET/gi, 'ON DUPLICATE KEY UPDATE').replace(/excluded\.(\w+)/gi, 'VALUES($1)');
  // `key` is reserved by MySQL; other identifiers are shared by both dialects.
  return value.replace(/'(?:''|[^'])*'|`[^`]*`|\bkey\b/g, token => token === 'key' ? '`key`' : token);
}
export async function mysqlQuery(connection: Pool | PoolConnection, sql: string, values: unknown[]) {
  const [result] = await connection.query(mysqlSQL(sql), values);
  return result;
}
