import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { serverRuntime } from './runtime.mjs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
const name=value('--name'),database=value('--database'),prefix=value('--prefix');
if(!args.includes('--name')||!args.includes('--database')||!args.includes('--prefix'))throw Error('Usage: npm run services:restore -- --name BACKUP_NAME --database NEW_EMPTY_DATABASE --prefix NEW_S3_PREFIX/');
if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(database)||['mysql','sys','information_schema','performance_schema',process.env.MYSQL_DATABASE].map(v=>v?.toLowerCase()).includes(database.toLowerCase()))throw Error('Refusing to restore into the live or a system database.');
if(!prefix||!prefix.endsWith('/')||prefix.startsWith('/')||prefix.includes('..')||prefix===process.env.S3_PREFIX||!prefix.startsWith('file_management/'))throw Error('Choose a new application-owned S3 prefix.');
const require=await serverRuntime(),{verifyServiceBackup}=require('./service-backup.js'),{s3Prefix,s3Client,getObject,putObject}=require('./blobs.js'),{mysqlPool}=require('./mysql.js'),{TABLES}=require('./mysql-schema.js');
let control,pool,connection;
try{
 await verifyServiceBackup(name);const source=s3Prefix()+'backups/'+name+'/',manifest=JSON.parse((await getObject(source+'backup.json')).toString()),snapshot=JSON.parse((await getObject(source+'database.json')).toString());
 const objects=await s3Client().send(new ListObjectsV2Command({Bucket:process.env.S3_BUCKET,Prefix:prefix,MaxKeys:1}));if(objects.KeyCount)throw Error('Restore S3 prefix is not empty.');
 control=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT)||3306,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD});
 const [tables]=await control.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[database]);if(tables.length)throw Error('Restore database must contain no tables.');
 await control.query('CREATE DATABASE IF NOT EXISTS `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
 process.env.MYSQL_DATABASE=database;pool=await mysqlPool();connection=await pool.getConnection();
 for(const hash of manifest.hashes)await putObject(prefix+'blobs/'+hash,await getObject(source+'blobs/'+hash));
 let keyFile=null;if(manifest.keyHash){const folder=path.resolve('.test-data','restored-'+randomBytes(8).toString('hex'));await mkdir(folder,{recursive:true,mode:0o700});keyFile=path.join(folder,'server.key');await writeFile(keyFile,await getObject(source+'server.key'),{flag:'wx',mode:0o600});}
 await connection.beginTransaction();let count=0;
 try{
  for(const table of TABLES){if(['sessions','auth_tokens','link_sessions','rate_limits'].includes(table))continue;const [definition]=await connection.query('SHOW COLUMNS FROM `'+table+'`'),allowed=new Set(definition.map(c=>c.Field));for(const row of snapshot.tables[table]){if(table==='operations'&&['backup-lease','backup-status','backup-last-success'].includes(row.key))continue;const keys=Object.keys(row);if(!keys.length||keys.some(key=>!allowed.has(key)))throw Error('Backup schema mismatch: '+table);await connection.query('INSERT INTO `'+table+'` ('+keys.map(k=>'`'+k+'`').join(',')+') VALUES('+keys.map(()=>'?').join(',')+')',keys.map(k=>row[k]));count++;}}
  await connection.commit();
 }catch(error){await connection.rollback();throw error}
 console.log(JSON.stringify({restored:true,database,s3Prefix:prefix,rows:count,files:snapshot.tables.files.length,blobs:manifest.hashes.length,keyFile,sessionsRestored:false,sourcePreserved:true},null,2));
}catch(error){console.error('Restore failed:',error.code||error.name,error.code?'Check database permissions.':error.message);process.exitCode=1}finally{connection?.release();await pool?.end();await control?.end();s3Client().destroy();}
