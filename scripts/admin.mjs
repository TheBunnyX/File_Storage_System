import { existsSync } from 'node:fs';
import { serverRuntime } from './runtime.mjs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const [action,rawEmail]=process.argv.slice(2),email=rawEmail?.trim().toLowerCase();
if(!['grant','revoke'].includes(action)||!email)throw Error('Usage: npm run admin -- grant|revoke account@example.com');
const require=await serverRuntime(),{one,run,transaction}=require('./db.js'),{mysqlPool,mysqlEnabled}=require('./mysql.js');
try{
 const user=await one('SELECT id FROM users WHERE email=?',email);if(!user)throw Error('Create this account before granting administrator access.');
 await transaction(async()=>{await run('UPDATE account_security SET role=? WHERE user_id=?',action==='grant'?'super_admin':'user',user.id);await run('INSERT INTO audit(user_id,action,detail,created) VALUES(?,?,?,?)',user.id,`admin.${action}-local`,'Changed by local server operator',new Date().toISOString());});
 console.log(action==='grant'?'Super Admin granted.':'Super Admin revoked.');
}finally{if(mysqlEnabled())await(await mysqlPool()).end();}
