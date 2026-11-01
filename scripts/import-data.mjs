import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { serverRuntime } from './runtime.mjs';
// Loads an archive from `npm run data:export` into the configured backends (e.g. inside the Docker/Dokploy app container).
// Usage: npm run data:import -- FILE.zip [--replace]. Without --replace it only imports over an empty or demo-only system.
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const args=process.argv.slice(2),file=args.find(arg=>!arg.startsWith('--')),replace=args.includes('--replace');
if(!file)throw Error('Usage: npm run data:import -- FILE.zip [--replace]');
const require=await serverRuntime(),{all,one,run,transaction,dataDirectory}=require('./db.js'),{TABLES}=require('./mysql-schema.js'),{putBlob,s3Enabled,s3Client}=require('./blobs.js'),{mysqlEnabled,mysqlPool}=require('./mysql.js'),{redisEnabled,redisClient}=require('./redis.js');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const zip=new AdmZip(path.resolve(file)),entry=name=>{const item=zip.getEntry(name);if(!item)throw Error('Archive is missing '+name);return item.getData();};
 const manifest=JSON.parse(entry('manifest.json').toString()),database=entry('database.json');
 if(manifest.kind!=='nexafile-export-v1'||!Array.isArray(manifest.hashes))throw Error('Not a NexaFile export archive.');
 if(digest(database)!==manifest.databaseHash)throw Error('Archive database failed integrity check.');
 const {tables}=JSON.parse(database.toString()),blobs=manifest.hashes.map(hash=>{if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid content identifier.');const bytes=entry('blobs/'+hash);if(digest(bytes)!==hash)throw Error('Archive file failed integrity check: '+hash);return [hash,bytes];});
 const key=manifest.keyHash?entry('server.key'):null;if(key&&(key.length!==32||digest(key)!==manifest.keyHash))throw Error('Archive server.key failed integrity check.');
 for(const table of Object.keys(tables))if(!TABLES.includes(table))throw Error('Archive has an unknown table: '+table);
 const existing={files:Number((await one('SELECT COUNT(*) AS n FROM files')).n),members:Number((await one('SELECT COUNT(*) AS n FROM users u LEFT JOIN account_profiles p ON p.user_id=u.id WHERE COALESCE(p.is_demo,0)=0')).n)};
 if((existing.files||existing.members)&&!replace)throw Error(`Destination already has ${existing.files} files and ${existing.members} non-demo members. Re-run with --replace to delete them and import the archive.`);
 // Content is addressed by hash, so writing it first is safe to repeat if the database step fails.
 for(const [hash,bytes] of blobs)await putBlob(hash,bytes);
 let rows=0;
 await transaction(async()=>{
  for(const table of [...TABLES].reverse())await run('DELETE FROM `'+table+'`');
  for(const table of TABLES)for(const row of tables[table]||[]){const columns=Object.keys(row);await run('INSERT INTO `'+table+'` ('+columns.map(c=>'`'+c+'`').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...columns.map(c=>row[c]));rows++;}
  for(const table of TABLES){const stored=Number((await one('SELECT COUNT(*) AS n FROM `'+table+'`')).n);if(stored!==(tables[table]||[]).length)throw Error('Row count verification failed: '+table);}
 });
 let keyBackup=null;
 if(key){const target=path.join(dataDirectory,'server.key');await mkdir(dataDirectory,{recursive:true,mode:0o700});if(existsSync(target)&&!(await readFile(target)).equals(key)){keyBackup=target+'.before-import-'+Date.now();await rename(target,keyBackup);}if(!existsSync(target))await writeFile(target,key,{flag:'wx',mode:0o600});}
 // Old session keys would point at deleted session rows; everyone signs in again.
 if(redisEnabled()){const redis=await redisClient(),prefix=process.env.REDIS_PREFIX||'file_management:';for await(const keys of redis.scanIterator({MATCH:prefix+'session:*',COUNT:100}))for(const k of [].concat(keys))await redis.del(k);await redis.quit();}
 console.log(JSON.stringify({imported:true,rows,users:(tables.users||[]).length,files:(tables.files||[]).length,blobs:blobs.length,serverKey:!!key,previousServerKey:keyBackup,from:manifest.created,next:'Restart the app so caches start fresh.'},null,2));
}catch(error){console.error('Import failed:',error.message||error);process.exitCode=1}
finally{if(mysqlEnabled())await(await mysqlPool()).end();if(s3Enabled())s3Client().destroy();}
