import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { serverRuntime } from './runtime.mjs';
// Writes one portable archive (database rows, file contents, server.key) from the configured backends.
// Usage: npm run data:export -- [output.zip]. The source is only read.
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const require=await serverRuntime(),{all,transaction,dataDirectory}=require('./db.js'),{TABLES}=require('./mysql-schema.js'),{readBlob,s3Enabled,s3Client}=require('./blobs.js'),{mysqlEnabled,mysqlPool}=require('./mysql.js');
// Sessions, tokens and upload staging are tied to the old host and are not carried over.
const SKIPPED=['sessions','auth_tokens','link_sessions','rate_limits','upload_sessions'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const created=new Date().toISOString(),output=path.resolve(process.argv[2]||`nexafile-export-${created.replace(/[:.]/g,'-')}.zip`);
try{
 if(existsSync(output))throw Error('Output file already exists: '+output);
 const tables=await transaction(async()=>{const result={};for(const table of TABLES)if(!SKIPPED.includes(table))result[table]=await all('SELECT * FROM `'+table+'`');return result;});
 tables.operations=tables.operations.filter(row=>!['backup-lease','backup-status','backup-last-success'].includes(row.key));
 const database=Buffer.from(JSON.stringify({kind:'nexafile-export-db-v1',created,tables})),zip=new AdmZip();
 zip.addFile('database.json',database);
 const hashes=[...new Set(tables.files.concat(tables.versions).map(row=>row.hash))];
 for(const hash of hashes){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid content identifier: '+hash);const bytes=await readBlob(hash);if(digest(bytes)!==hash)throw Error('Stored file failed integrity check: '+hash);zip.addFile('blobs/'+hash,bytes);}
 let keyHash=null;const keyFile=path.join(dataDirectory,'server.key');
 if(existsSync(keyFile)){const key=await readFile(keyFile);keyHash=digest(key);zip.addFile('server.key',key);}
 const counts=Object.fromEntries(Object.entries(tables).map(([table,rows])=>[table,rows.length]));
 zip.addFile('manifest.json',Buffer.from(JSON.stringify({kind:'nexafile-export-v1',created,source:{database:mysqlEnabled()?'mysql':'sqlite',blobs:s3Enabled()?'s3':'local'},databaseHash:digest(database),hashes,keyHash,counts},null,2)));
 await zip.writeZipPromise(output,{overwrite:false});
 console.log(JSON.stringify({exported:true,file:output,users:counts.users,files:counts.files,blobs:hashes.length,serverKey:!!keyHash},null,2));
}catch(error){console.error('Export failed:',error.message||error);process.exitCode=1}
finally{if(mysqlEnabled())await(await mysqlPool()).end();if(s3Enabled())s3Client().destroy();}
