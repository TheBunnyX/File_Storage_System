import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {setTimeout as sleep} from 'node:timers/promises';import {randomBytes} from 'node:crypto';
// `--mysql` runs the same checks against a throwaway database on the MySQL server from .env.local.
const useMysql=process.argv.includes('--mysql'),database='file_management_test_'+randomBytes(6).toString('hex');let control,created=false;
if(useMysql)process.loadEnvFile('.env.local');
const storage=await mkdtemp(path.join(os.tmpdir(),'nexafile-departments-')),base='http://127.0.0.1:3113';let server,output='',checks=0;
const check=(v,label)=>{assert.ok(v,label);checks++};
async function start(){server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3113','-H','127.0.0.1'],{env:{...process.env,DATABASE_BACKEND:useMysql?'mysql':'sqlite',MYSQL_DATABASE:database,BLOB_BACKEND:'local',REDIS_ENABLED:'false',NEXAFILE_DEMO:'false',NEXAFILE_DATA_DIR:storage,NEXAFILE_BACKUP_DIR:storage+'-backups',NEXAFILE_BACKUPS:'off',NEXAFILE_ADMIN_EMAILS:'owner@departments.test',APP_URL:base,CLAMAV_HOST:'',CLAMAV_SOCKET:'',ANTIVIRUS_REQUIRED:'false',DISABLE_REGISTRATION:'false',NEXAFILE_QUOTA_MB:'1024',NEXAFILE_MAX_UPLOAD_MB:'50'},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error(output);try{if((await fetch(base)).ok)return}catch{}await sleep(100)}throw Error('Server not ready '+output)}
async function stop(){if(!server||server.exitCode!==null)return;const ended=new Promise(r=>server.once('exit',r));server.kill();await ended}
class Client{cookies=new Map();
 async fetch(url,init,status){const r=await fetch(base+'/api'+url,{...init,headers:{...init.headers,...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{}),...(init.method!=='GET'?{Origin:base}:{})},signal:AbortSignal.timeout(30000)});for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');this.cookies.set(pair.slice(0,i),pair.slice(i+1))}const data=await r.json();assert.equal(r.status,status,`${init.method} ${url}: ${JSON.stringify(data)}`);checks++;return data}
 req(url,method='GET',body,status=200){return this.fetch(url,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},status)}
 upload(name,bytes,status=201){const form=new FormData();form.append('files',new Blob([Buffer.alloc(bytes,97)]),name);return this.fetch('/files',{method:'POST',headers:{},body:form},status)}}
const owner=new Client(),alice=new Client(),bob=new Client(),carol=new Client(),dave=new Client(),erin=new Client(),guest=new Client(),MB=1048576;
try{
 if(useMysql){const mysql=(await import('mysql2/promise')).default;control=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD});await control.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created=true}
 await start();
 for(const [client,name] of [[owner,'owner'],[alice,'alice'],[bob,'bob'],[carol,'carol'],[dave,'dave'],[erin,'erin']])await client.req('/auth/register','POST',{name,email:`${name}@departments.test`,password:'department-test-password'},200);
 const id=async email=>(await owner.req('/admin')).users.find(u=>u.email===email).id;
 const [aliceId,bobId,carolId,ownerId]=await Promise.all(['alice','bob','carol','owner'].map(n=>id(`${n}@departments.test`)));
 // Departments and membership
 await owner.req('/admin/user','POST',{id:aliceId,department:'Sales'},400);
 await owner.req('/admin/department','POST',{name:'Sales',quota:MB});
 await owner.req('/admin/department','POST',{name:'Empty',quota:5*MB});
 for(const member of [aliceId,bobId])await owner.req('/admin/user','POST',{id:member,department:'Sales'});
 let admin=await owner.req('/admin');const sales=admin.departments.find(d=>d.name==='Sales');
 check(sales&&sales.members===2&&sales.quota===MB,'Department lists members and storage');
 // Shared pool: alice and bob share 1 MB, carol keeps the personal default
 await alice.upload('alice.txt',600*1024);
 check((await bob.req('/workspace')).used>=600*1024,'Department members see shared usage');
 check((await bob.req('/workspace')).quota===MB,'Department members get the department quota');
 await bob.upload('bob.txt',600*1024,413);
 await carol.upload('carol.txt',600*1024);
 check((await carol.req('/workspace')).quota===1024*MB,'Members without a department keep the default quota');
 await owner.req('/admin/department','POST',{name:'Sales',quota:2*MB});
 await bob.upload('bob.txt',600*1024);
 // Concurrent uploads cannot overshoot the shared pool
 await owner.req('/admin/department','POST',{name:'Race',quota:MB});
 for(const email of ['dave@departments.test','erin@departments.test'])await owner.req('/admin/user','POST',{id:await id(email),department:'Race'});
 const race=async(client,name)=>{const form=new FormData();form.append('files',new Blob([Buffer.alloc(300*1024,98)]),name);return (await fetch(base+'/api/files',{method:'POST',headers:{Cookie:[...client.cookies].map(([k,v])=>`${k}=${v}`).join('; '),Origin:base},body:form})).status};
 const statuses=await Promise.all([0,1,2,3,4,5].map(i=>race(i%2?dave:erin,`race-${i}.txt`)));
 check(statuses.filter(s=>s===201).length===3&&statuses.every(s=>s===201||s===413),'Concurrent uploads stop at the department quota: '+statuses.join(','));
 check((await dave.req('/workspace')).used<=MB,'Department pool never exceeds its quota');
 // Department admin scope
 await owner.req('/admin/user','POST',{id:bobId,role:'department_admin'});
 const scoped=await bob.req('/admin');
 check(scoped.departments.length===1&&scoped.departments[0].name==='Sales','Department admin sees only its department');
 check(scoped.settings===null,'Department admin cannot read system settings');
 await bob.req('/admin/department','POST',{name:'Sales',quota:100*MB},403);
 await bob.req('/admin/settings','POST',{registration:true,defaultQuotaMb:1,maxUploadMb:1,trashRetentionDays:0},403);
 await bob.req('/admin/user','POST',{id:aliceId,role:'super_admin'},403);
 await bob.req('/admin/user','POST',{id:aliceId,blocked:true});
 await bob.req('/admin/user','POST',{id:carolId,blocked:true},403);
 // Super admin guards
 await owner.req('/admin/user','POST',{id:ownerId,role:'user'},400);
 await owner.req('/admin/department','POST',{name:'Sales',remove:true},409);
 await owner.req('/admin/department','POST',{name:'Empty',remove:true});
 check(!(await owner.req('/admin')).departments.some(d=>d.name==='Empty'),'Empty department removed');
 // System settings apply without a restart
 await owner.req('/admin/settings','POST',{registration:false,defaultQuotaMb:5,maxUploadMb:1,trashRetentionDays:7});
 admin=await owner.req('/admin');
 check(admin.settings.registration===false&&admin.settings.maxUploadMb===1&&admin.settings.trashRetentionDays===7,'Settings saved');
 check((await guest.req('/auth/config')).registration===false,'Registration flag exposed');
 await guest.req('/auth/register','POST',{name:'late',email:'late@departments.test',password:'department-test-password'},403);
 check((await carol.req('/workspace')).maxUpload===MB,'Upload limit applies immediately');
 check((await carol.req('/workspace')).quota===5*MB,'Default quota applies immediately');
 await carol.upload('big.txt',MB+1,413);
 await owner.req('/admin/settings','POST',{registration:true,defaultQuotaMb:5,maxUploadMb:500,trashRetentionDays:7},400);
 const actions=admin.events.map(e=>e.action);
 check(['admin.department-updated','admin.department-removed','admin.settings-updated'].every(a=>actions.includes(a)),'Changes are audited');
 console.log(`PASS: ${checks} department storage and system settings checks on ${useMysql?'MySQL':'SQLite'}. Isolated data: ${storage}`);
}catch(error){console.error(error);console.error(output.slice(-3000));process.exitCode=1}finally{await stop();if(created&&/^file_management_test_[a-f0-9]{12}$/.test(database))await control.query('DROP DATABASE `'+database+'`');await control?.end()}
