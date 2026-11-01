import { readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { serverRuntime } from './runtime.mjs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const directory = path.resolve(process.env.NEXAFILE_DATA_DIR || 'data'),apply=process.argv.includes('--apply');
if(apply&&!process.argv.includes('--server-stopped'))throw Error('Stop the NexaFile server first, then use --apply --server-stopped.');
const require=await serverRuntime(),{all}=require('./db.js'),{mysqlEnabled,mysqlPool}=require('./mysql.js');
try{
 const referenced=new Set((await all('SELECT DISTINCT hash FROM versions UNION SELECT DISTINCT hash FROM files')).map(row=>row.hash));let count=0,bytes=0;
 const cache=path.resolve(directory,'blobs');const relative=path.relative(directory,cache);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unsafe cache path.');
 if(existsSync(cache))for(const name of await readdir(cache)){if(!/^[a-f0-9]{64}$/.test(name)||referenced.has(name))continue;const file=path.join(cache,name),info=await stat(file);if(!info.isFile()||info.mtimeMs>Date.now()-86400000)continue;if(apply)await unlink(file);count++;bytes+=info.size;}
 console.log(`${apply?'Removed':'Dry run: would remove'} ${count} unreferenced local cache files (${bytes} bytes), older than 24 hours. S3 originals are never deleted by this command.`);
}finally{if(mysqlEnabled())await(await mysqlPool()).end();}
