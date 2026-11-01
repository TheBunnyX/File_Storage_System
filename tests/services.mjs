import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { serverRuntime } from '../scripts/runtime.mjs';
process.loadEnvFile('.env.local');
const id=randomBytes(6).toString('hex'),database='file_management_test_'+id,restoreDatabase='file_management_restore_'+id,prefix='file_management/test/'+id+'/',redisPrefix='file_management:test:'+id+':',base='http://127.0.0.1:3111';
const storage=await mkdtemp(path.join(os.tmpdir(),'nexafile-services-'));
Object.assign(process.env,{DATABASE_BACKEND:'mysql',BLOB_BACKEND:'s3',REDIS_ENABLED:'true',MYSQL_DATABASE:database,S3_PREFIX:prefix,REDIS_PREFIX:redisPrefix,NEXAFILE_DATA_DIR:storage,NEXAFILE_BACKUPS:'off',APP_URL:base,CLAMAV_HOST:'',CLAMAV_SOCKET:'',ANTIVIRUS_REQUIRED:'false',NEXAFILE_DEMO:'false',NEXAFILE_ADMIN_EMAILS:'owner@services.test',DISABLE_REGISTRATION:'false'});
const require=await serverRuntime(),{s3Client,getObject}=require('./blobs.js'),{redisClient,redisRateLimit}=require('./redis.js');
let server,output='',control,redis,created=false,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++};
async function start(){server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3111','-H','127.0.0.1'],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Server stopped');try{if((await fetch(base)).ok)return}catch{}await sleep(100)}throw Error('Server not ready')}
async function stop(){if(!server||server.exitCode!==null)return;const ended=new Promise(r=>server.once('exit',r));server.kill();await ended}
class Client{cookies=new Map();async req(url,method='GET',body,status=200,extra={}){const r=await fetch(base+'/api'+url,{method,headers:{...extra,...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...(method!=='GET'?{Origin:base}:{}),...(body!==undefined&&!Buffer.isBuffer(body)&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:Buffer.isBuffer(body)||body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});for(const item of r.headers.getSetCookie()){const pair=item.split(';')[0],i=pair.indexOf('=');this.cookies.set(pair.slice(0,i),pair.slice(i+1))}const data=r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer());assert.equal(r.status,status,`${method} ${url}: ${JSON.stringify(data)}`);checks++;return data}}

function fixturePdf(text){const stream='BT /F1 16 Tf 45 740 Td ('+text+') Tj ET',objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream'];let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(pdf);}
function totp(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest(),offset=h[19]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}

try{
 control=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD});
 await control.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created=true;await start();
 const owner=new Client(),other=new Client(),guest=new Client();const pass='service-test-password-123';
 await owner.req('/auth/register','POST',{name:'Service Owner',email:'owner@services.test',password:pass});await other.req('/auth/register','POST',{name:'Other',email:'other@services.test',password:pass});
 let workspace=await owner.req('/workspace');check(workspace.user.role==='super_admin','MySQL account roles');
 redis=await redisClient();const hash=createHash('sha256').update(owner.cookies.get('nexafile_session')).digest('hex');check(!!await redis.get(redisPrefix+'session:'+hash),'Session stored in Redis');
 await owner.req('/preferences','PATCH',{language:'th',sort:'size-desc'});check((await owner.req('/workspace')).preferences.language==='th','MySQL preference upsert');
 const content=Buffer.from('MySQL Redis SeaweedFS roundtrip ภาษาไทย 48000'),fingerprint=createHash('sha256').update(content).digest('hex');
 const upload=await owner.req('/uploads','POST',{name:'ข้อมูล.txt',hash:fingerprint,size:content.length},201);await owner.req('/uploads/'+upload.id,'PUT',content.subarray(0,9),200,{'X-Upload-Offset':'0'});await stop();await start();check((await owner.req('/uploads/'+upload.id)).offset===9,'MySQL upload resumes and Redis session persists after restart');
 await owner.req('/uploads/'+upload.id,'PUT',content.subarray(9),200,{'X-Upload-Offset':'9'});const done=await owner.req('/uploads/'+upload.id+'/complete','POST',{}),fileId=done.resultId;
 check((await getObject(prefix+'blobs/'+fingerprint)).equals(content),'Original file exists in actual SeaweedFS S3');check((await owner.req('/files/'+fileId+'/content')).equals(content),'S3 file served by API');await other.req('/files/'+fileId,'GET',undefined,404);
 check((await owner.req('/search?q='+encodeURIComponent('ภาษาไทย'))).ids.includes(fileId),'MySQL Thai content search');
 const version=new FormData();version.append('file',new Blob(['second version']), 'ข้อมูล.txt');await owner.req('/files/'+fileId+'/versions','POST',version,201);check((await owner.req('/files/'+fileId)).versions.length===2,'MySQL version history');
 await owner.req('/files/bulk','PATCH',{items:[{id:fileId,changes:{name:'should-rollback.txt'}},{id:9999999,changes:{deleted:true}}]},404);check((await owner.req('/files/'+fileId)).file.name==='ข้อมูล.txt','MySQL transaction rolls back partial changes');
 await owner.req('/files/'+fileId,'PATCH',{favorite:true,tags:['ทดสอบ']});check((await owner.req('/files/'+fileId)).file.favorite,'MySQL favorite insert ignore');await owner.req('/files/'+fileId,'PATCH',{favorite:false});
 const shared=await owner.req('/files/'+fileId+'/links','POST',{password:'share-service-123',download:true},201),token=new URL(shared.url).pathname.split('/').pop();check((await guest.req('/public/'+token)).locked,'MySQL share link password');await guest.req('/public/'+token,'POST',{password:'share-service-123'});check((await guest.req('/public/'+token+'/download')).toString()==='second version','S3 public download');
 const backup=await owner.req('/admin/backup','POST',{});check(backup.kind==='nexafile-mysql-s3-v1'&&backup.verified,'MySQL logical snapshot and S3 blob backup');check((await owner.req('/admin/verify-backup','POST',{name:backup.name})).verified,'Remote backup can be independently verified');
 const snapshot=JSON.parse((await getObject(prefix+'backups/'+backup.name+'/database.json')).toString());check(snapshot.tables.users.length===2&&snapshot.tables.versions.length===2,'Remote backup contains actual MySQL data');

 const pdf=fixturePdf('S3-backed PDF preview'),pdfHash=createHash('sha256').update(pdf).digest('hex'),form=new FormData();form.append('files',new Blob([pdf]),'preview.pdf');const pdfId=(await owner.req('/files','POST',form,201)).ids[0];await unlink(path.join(storage,'blobs',pdfHash));
 const preview=await owner.req('/files/'+pdfId+'/preview?page=1');check(preview.subarray(1,4).toString()==='PNG','PDF preview restores missing cache from S3');
 const mfa=await owner.req('/auth/mfa-setup','POST',{currentPassword:pass});const enabled=await owner.req('/auth/mfa-enable','POST',{currentPassword:pass,code:totp(mfa.secret)});check(enabled.recoveryCodes.length===8,'MySQL stores MFA configuration');
 const recoveryLogin=new Client();await recoveryLogin.req('/auth/login','POST',{email:'owner@services.test',password:pass,code:enabled.recoveryCodes[0]});await guest.req('/auth/login','POST',{email:'owner@services.test',password:pass,code:enabled.recoveryCodes[0]},401);
 await owner.req('/admin/backup-settings','POST',{enabled:false,intervalMinutes:15,retain:1});const secondBackup=await owner.req('/admin/backup','POST',{});check(secondBackup.verified,'S3 backup verifies the encryption key');
 const manifest=JSON.parse((await getObject(prefix+'backups/'+secondBackup.name+'/backup.json')).toString());check(!!manifest.keyHash&&manifest.verified,'Remote backup includes verified MFA key');
 await assert.rejects(()=>getObject(prefix+'backups/'+backup.name+'/backup.json'),error=>error.$metadata?.httpStatusCode===404);checks++;
 const restored=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/restore-services.mjs','--name',secondBackup.name,'--database',restoreDatabase,'--prefix',prefix+'restore/'],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.once('error',reject);child.once('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error('Isolated restore failed: '+err)));});
 check(restored.restored&&restored.blobs===3,'Verified remote backup restores to a new MySQL database and S3 prefix');
 const [restoredUsers]=await control.query('SELECT COUNT(*) AS count FROM `'+restoreDatabase+'`.users'),[restoredSessions]=await control.query('SELECT COUNT(*) AS count FROM `'+restoreDatabase+'`.sessions');check(Number(restoredUsers[0].count)===2&&Number(restoredSessions[0].count)===0,'Restored users retained and old sessions revoked');
 check((await getObject(prefix+'restore/blobs/'+fingerprint)).equals(content),'Restored S3 bytes match original');
 const attempts=await Promise.all(Array.from({length:12},()=>redisRateLimit('atomic-probe',5,60000)));check(attempts.filter(Boolean).length===5,'Redis Lua rate limit is atomic across concurrent requests');
 const old=owner.cookies.get('nexafile_session'),logoutHash=createHash('sha256').update(old).digest('hex');await owner.req('/auth/logout','POST');check(!await redis.get(redisPrefix+'session:'+logoutHash),'Logout removes Redis session');owner.cookies.set('nexafile_session',old);await owner.req('/workspace','GET',undefined,401);
 const [rows]=await control.query('SELECT COUNT(*) AS count FROM `'+database+'`.users');check(Number(rows[0].count)===2,'Users stored in MySQL, not SQLite');
 console.log(`PASS: ${checks} live MySQL + Redis + SeaweedFS integration checks; isolated database and prefixes.`);
}catch(error){console.error(error.code||error.name,error.message);const lines=output.split('\n').filter(l=>l.includes('NexaFile request failed'));if(lines.length)console.error(lines.slice(-3).join('\n'));process.exitCode=1}
finally{
 await stop();
 if(created&&/^file_management_test_[a-f0-9]{12}$/.test(database))await control.query('DROP DATABASE `'+database+'`');if(control&&/^file_management_restore_[a-f0-9]{12}$/.test(restoreDatabase))await control.query('DROP DATABASE IF EXISTS `'+restoreDatabase+'`');await control?.end();
 try{redis??=await redisClient();const keys=await redis.keys(redisPrefix+'*');if(keys.length)await redis.del(keys);}finally{if(redis?.isOpen)await redis.quit();}
 // Only remove objects beneath this run's generated test prefix.
 let continuation;do{const page=await s3Client().send(new ListObjectsV2Command({Bucket:process.env.S3_BUCKET,Prefix:prefix,ContinuationToken:continuation}));for(const entry of page.Contents||[]){assert.ok(entry.Key.startsWith(prefix));await s3Client().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:entry.Key}));}continuation=page.NextContinuationToken;}while(continuation);s3Client().destroy();
}
