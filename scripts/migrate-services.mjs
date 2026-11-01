import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serverRuntime } from './runtime.mjs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const require=await serverRuntime(),{mysqlPool}=require('./mysql.js'),{TABLES}=require('./mysql-schema.js'),{putObject,getObject,s3Prefix,s3Client}=require('./blobs.js'),{redisClient,cacheSession}=require('./redis.js');
const sourceDir=path.resolve(process.env.NEXAFILE_DATA_DIR||'data'),sourcePath=path.join(sourceDir,'nexafile.sqlite');
if(!existsSync(sourcePath))throw Error('No local source database. Migration not performed.');
const sqlite=new DatabaseSync(sourcePath,{readOnly:true});let pool,redis,connection;
try{
 pool=await mysqlPool();connection=await pool.getConnection();
 const [existing]=await connection.query("SELECT value FROM operations WHERE `key`='sqlite-migration'");
 if(existing.length){console.log('Migration already completed. Original SQLite data remains unchanged.');}
 else{
  for(const table of TABLES){const [rows]=await connection.query('SELECT COUNT(*) AS count FROM `'+table+'`');if(Number(rows[0].count)!==0)throw Error('Destination is not empty: '+table+'. Migration stopped without overwriting data.');}
  const localBackup=path.resolve('.test-data','migration-backup-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(localBackup,{recursive:true});await backup(sqlite,path.join(localBackup,'nexafile.sqlite'));if(existsSync(path.join(sourceDir,'server.key')))await copyFile(path.join(sourceDir,'server.key'),path.join(localBackup,'server.key'));
  const hashes=sqlite.prepare('SELECT DISTINCT hash FROM files UNION SELECT DISTINCT hash FROM versions').all().map(r=>r.hash);
  for(const hash of hashes){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid blob hash');const bytes=await readFile(path.join(sourceDir,'blobs',hash));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Local file integrity check failed');const key=s3Prefix()+'blobs/'+hash;await putObject(key,bytes);if(!(await getObject(key)).equals(bytes))throw Error('S3 migration verification failed');}
  await connection.beginTransaction();let count=0;
  try{for(const table of TABLES){const rows=sqlite.prepare('SELECT * FROM "'+table+'"').all();for(const row of rows){const columns=Object.keys(row);await connection.query('INSERT INTO `'+table+'` ('+columns.map(k=>'`'+k+'`').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',columns.map(k=>row[k]));count++;}const [stored]=await connection.query('SELECT COUNT(*) AS count FROM `'+table+'`');if(Number(stored[0].count)!==rows.length)throw Error('Row count verification failed: '+table);}
   await connection.query('INSERT INTO operations(`key`,value) VALUES(?,?)',['sqlite-migration',JSON.stringify({completed:new Date().toISOString(),rows:count,blobs:hashes.length})]);await connection.commit();
  }catch(error){await connection.rollback();throw error}

  console.log(JSON.stringify({migrated:true,tables:TABLES.length,rows:count,blobsVerified:hashes.length,localRecoverySnapshot:localBackup,sourcePreserved:true},null,2));
 }
 process.env.REDIS_ENABLED='true';redis=await redisClient();const [active]=await connection.query('SELECT * FROM sessions WHERE expires>?',[Date.now()]);for(const session of active)await cacheSession(session.token,Number(session.user_id),Number(session.expires));
}catch(error){console.error('Migration failed:',error.code||error.name,error.code?'Check MySQL configuration and permissions.':error.message);process.exitCode=1}finally{sqlite.close();connection?.release();await pool?.end();if(redis?.isOpen)await redis.quit();s3Client().destroy()}
