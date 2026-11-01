import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blobDirectory, requireValue } from './db';

export const s3Enabled = () => {const backend=process.env.BLOB_BACKEND;if(backend&&!['s3','local'].includes(backend))throw new Error('Invalid BLOB_BACKEND.');return backend==='s3';};
export const s3Prefix = () => (process.env.S3_PREFIX || 'file_management/').replace(/^\/+/, '').replace(/\/*$/, '/');
let s3: S3Client | undefined;
export function s3Client() {
  return s3 ??= new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', forcePathStyle: true, maxAttempts: 3, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! }, requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 } });
}
function key(hash: string) { requireValue(/^[a-f0-9]{64}$/.test(hash), 'Invalid content identifier.', 500); return s3Prefix() + 'blobs/' + hash; }
export async function putObject(key: string, body: Buffer, contentType = 'application/octet-stream') {
  await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentLength: body.length, ContentType: contentType }));
}
export async function getObject(key: string) {
  const response = await s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  return Buffer.from(await response.Body!.transformToByteArray());
}
export async function putBlob(hash: string, bytes: Buffer) {
  key(hash);
  requireValue(createHash('sha256').update(bytes).digest('hex') === hash, 'File checksum mismatch.', 500);
  if (s3Enabled()) await putObject(key(hash), bytes);
  await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
  try { await writeFile(path.join(blobDirectory, hash), bytes, { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export async function readBlob(hash: string) {
  const objectKey = key(hash);
  const bytes = s3Enabled() ? await getObject(objectKey) : await readFile(path.join(blobDirectory, hash));
  requireValue(createHash('sha256').update(bytes).digest('hex') === hash, 'Stored file failed integrity verification.', 500);
  return bytes;
}
export async function localBlob(hash: string) {
  key(hash);
  const file = path.join(blobDirectory, hash);
  try { const bytes = await readFile(file); if (createHash('sha256').update(bytes).digest('hex') === hash) return file; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bytes = await readBlob(hash); await mkdir(blobDirectory, { recursive: true, mode: 0o700 }); await writeFile(file, bytes, { mode: 0o600 }); return file;
}
