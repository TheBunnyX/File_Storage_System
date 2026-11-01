import { existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { serverRuntime } from './runtime.mjs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const require = await serverRuntime(), {mysqlPool} = require('./mysql.js'), {redisClient} = require('./redis.js'), {s3Client,s3Prefix,putObject,getObject} = require('./blobs.js');
const id=randomUUID(),results=[];
let pool,redis;
try {
  pool=await mysqlPool(); const connection=await pool.getConnection();
  try {await connection.beginTransaction();await connection.query('INSERT INTO operations(`key`,value) VALUES(?,?)',['health:'+id,'round-trip']);const [rows]=await connection.query('SELECT value FROM operations WHERE `key`=?',['health:'+id]);if(rows[0]?.value!=='round-trip')throw Error('RoundTripFailed');results.push({service:'MySQL',endpoint:`${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}`,database:process.env.MYSQL_DATABASE,authenticated:true,writeReadRollback:true});}finally{await connection.rollback();connection.release();}
}catch(error){results.push({service:'MySQL',ok:false,error:error.code||error.name});process.exitCode=1;}
try {redis=await redisClient();const key=(process.env.REDIS_PREFIX||'file_management:')+'health:'+id;try{await redis.set(key,'round-trip',{EX:60});if(await redis.get(key)!=='round-trip')throw Error('RoundTripFailed');results.push({service:'Redis',endpoint:`${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,database:Number(process.env.REDIS_DB||0),prefix:process.env.REDIS_PREFIX,ping:await redis.ping(),writeRead:true});}finally{await redis.del(key);}}catch(error){results.push({service:'Redis',ok:false,error:error.code||error.name});process.exitCode=1;}
try {const key=s3Prefix()+'health/'+id+'.txt',body=Buffer.from('NexaFile connectivity probe '+id);try{await putObject(key,body,'text/plain');const downloaded=await getObject(key);if(!downloaded.equals(body))throw Error('RoundTripFailed');results.push({service:'SeaweedFS S3',endpoint:process.env.S3_ENDPOINT,bucket:process.env.S3_BUCKET,writeRead:true,sha256:createHash('sha256').update(downloaded).digest('hex')});}finally{await s3Client().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));}}catch(error){results.push({service:'SeaweedFS S3',ok:false,error:error.name,http:error.$metadata?.httpStatusCode});process.exitCode=1;}
console.log(JSON.stringify({checked:new Date().toISOString(),results,secrets:'hidden'},null,2));
await pool?.end();if(redis?.isOpen)await redis.quit();s3Client().destroy();
