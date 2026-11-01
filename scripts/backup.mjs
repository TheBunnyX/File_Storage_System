import {existsSync} from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
if(process.env.DATABASE_BACKEND!=='mysql'){await import('./backup-local.mjs');}else{
const {serverRuntime}=await import('./runtime.mjs');const require=await serverRuntime(),{runBackup}=require('./operations.js'),{mysqlPool}=require('./mysql.js'),{s3Client}=require('./blobs.js');
try{const result=await runBackup(null);console.log(JSON.stringify(result,null,2));}finally{await(await mysqlPool()).end();s3Client().destroy();}
}
