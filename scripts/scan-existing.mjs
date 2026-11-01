import { existsSync } from 'node:fs';
import { serverRuntime } from './runtime.mjs';
// Scans stored files that have no clean/infected result yet (e.g. uploaded before ClamAV was configured).
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const require=await serverRuntime(),{all}=require('./db.js'),{mysqlPool,mysqlEnabled}=require('./mysql.js'),{readBlob}=require('./blobs.js'),{scanBytes,recordScan,scanConfiguration}=require('./antivirus.js');
try{
 if(!scanConfiguration().configured)throw Error('Set CLAMAV_HOST/PORT or CLAMAV_SOCKET before scanning.');
 const rows=await all("SELECT DISTINCT v.hash FROM versions v LEFT JOIN blob_scans s ON s.hash=v.hash WHERE s.status IS NULL OR s.status NOT IN ('clean','infected')");
 const totals={clean:0,infected:0,failed:0};
 for(const {hash} of rows){
  try{await recordScan(hash,await scanBytes(await readBlob(hash)));totals.clean++;}
  catch(error){if(error?.status===422){await recordScan(hash,'infected');totals.infected++;console.log(`Infected: ${hash}`);}else{totals.failed++;console.log(`Could not scan ${hash}: ${error?.message||error}`);}}
 }
 console.log(`Scanned ${rows.length} stored files: ${totals.clean} clean, ${totals.infected} infected, ${totals.failed} failed.`);
 if(totals.failed)process.exitCode=1;
}finally{if(mysqlEnabled())await(await mysqlPool()).end();}
