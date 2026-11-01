import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {serverRuntime} from '../scripts/runtime.mjs';

process.env.DATABASE_BACKEND='sqlite';process.env.BLOB_BACKEND='local';process.env.REDIS_ENABLED='false';
const require=await serverRuntime();
process.env.NEXAFILE_DATA_DIR=await mkdtemp(path.resolve('.test-data/performance-'));
const {run,all,measureDatabaseQueries,db}=require('./db.js');
const {workspaceFiles,workspaceActivities,foldersFor,accessibleFiles,serializeFile}=require('./storage.js');
const {securityFor}=require('./security.js');
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++};
const owner={id:1,name:'Owner',email:'owner@performance.test'},viewer={id:2,name:'Viewer',email:'viewer@performance.test'},stranger={id:3,name:'Other',email:'other@performance.test'};
const now=new Date().toISOString();
try {
 for(const user of [owner,viewer,stranger])await run('INSERT INTO users(id,name,email,password,created) VALUES(?,?,?,?,?)',user.id,user.name,user.email,'unused-fixture',now);
 await run('INSERT INTO folders(id,owner_id,name,color,created) VALUES(1,1,?,?,?)','Shared folder','blue',now);
 await run("INSERT INTO shares(kind,resource_id,user_id,permission) VALUES('folder',1,2,'viewer')");
 const insert=async(id,folder=null,deleted=0)=>run('INSERT INTO files(id,owner_id,folder_id,name,tags,type,mime,bytes,hash,text,extraction_status,deleted,created,modified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,1,folder,`File ${id}.txt`,'["Research"]','Document','text/plain',100,'a'.repeat(64),'เอกสาร😀'.repeat(5000),'Indexed',deleted,now,now);
 await insert(1,1);
 const small=await measureDatabaseQueries(()=>workspaceFiles(owner));
 for(let id=2;id<=201;id++)await insert(id,id<=5?1:null,id===5?1:0);
 await run("INSERT INTO shares(kind,resource_id,user_id,permission) VALUES('file',2,2,'editor')");
 await run("INSERT INTO shares(kind,resource_id,user_id,permission) VALUES('file',6,2,'viewer')");
 await run('INSERT INTO favorites(user_id,file_id) VALUES(2,2)');
 const large=await measureDatabaseQueries(()=>workspaceFiles(owner));
 check(small.queries===1&&large.queries===1,'1 and 201 files each take one metadata query');
 check(large.value.length===201,'Owner can see every own file including Trash');
 check(large.value.every(f=>f.excerpt.length<=300),'Large indexed documents produce bounded excerpts');
 check(!JSON.stringify(large.value).includes('owner@performance.test'),'Workspace file projection excludes owner email');
 const rows=await accessibleFiles(viewer),bulk=await workspaceFiles(viewer);
 for(const row of rows){assert.deepEqual(bulk.find(f=>f.id===row.id),await serializeFile(viewer,row));checks++;}
 check(bulk.length===5&&!bulk.some(f=>f.id===5),'Shared access excludes Trash and unshared files');
 check(bulk.find(f=>f.id===2).permission==='editor'&&bulk.find(f=>f.id===2).favorite,'Strongest inherited/direct grant and personal favorite preserved');
 check((await workspaceFiles(stranger)).length===0,'Unrelated account receives no files');
 const folders=await measureDatabaseQueries(()=>foldersFor(viewer));
 check(folders.queries===1&&folders.value[0].count===4&&folders.value[0].permission==='viewer','Folder counts and permissions take one query');
 await run('INSERT INTO activities(file_id,owner_id,actor_id,action,created) VALUES(1,1,1,?,?)','Visible activity',now);
 for(let n=0;n<505;n++)await run('INSERT INTO activities(owner_id,actor_id,action,created) VALUES(3,3,?,?)','Private activity',now);
 const activity=await measureDatabaseQueries(()=>workspaceActivities(viewer));
 check(activity.queries===1&&activity.value.length===1&&activity.value[0].action==='Visible activity','Scoped activity query finds accessible history beyond 500 other events');
 check((await workspaceActivities(stranger)).every(a=>a.action==='Private activity'),'Activity permissions exclude other accounts');
 await securityFor(1);const authRead=await measureDatabaseQueries(()=>securityFor(1));check(authRead.queries===1,'Existing security record is read without an unnecessary write');
 const indexes=await all("SELECT name FROM sqlite_master WHERE type='index'");check(indexes.some(i=>i.name==='files_owner_deleted_modified')&&indexes.some(i=>i.name==='shares_resource'),'Workspace composite indexes exist');
 console.log(`PASS: ${checks} performance/ACL checks. File metadata: 1 query for both 1 and 201 files; excerpts capped at 300 characters.`);
} finally {db().close();}
