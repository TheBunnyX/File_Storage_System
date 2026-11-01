import { createClient } from 'redis';
import { createHash } from 'node:crypto';

export const redisEnabled = () => process.env.REDIS_ENABLED === 'true';
const prefix = () => process.env.REDIS_PREFIX || 'file_management:';
let client: ReturnType<typeof createClient> | undefined;
let connecting: Promise<unknown> | undefined;
export async function redisClient() {
  if (!client) {
    const database = Number(process.env.REDIS_DB || 0);
    if (!Number.isSafeInteger(database) || database < 0) throw new Error('REDIS_DB must be a non-negative database number.');
    client = createClient({ socket: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) || 6379, connectTimeout: 5000, reconnectStrategy: false }, username: process.env.REDIS_USERNAME || 'default', password: process.env.REDIS_PASSWORD, database });
    client.on('error', () => {});
  }
  if (!client.isReady) {
    connecting ??= client.connect().finally(() => { connecting = undefined; });
    await connecting;
  }
  return client;
}
export async function cacheSession(tokenHash: string, userId: number, expires: number) {
  if (redisEnabled()) await (await redisClient()).set(prefix() + 'session:' + tokenHash, JSON.stringify({ userId, expires }), { PX: Math.max(1, expires - Date.now()) });
}
export async function sessionIsActive(tokenHash: string, userId: number) {
  if (!redisEnabled()) return true;
  const raw = await (await redisClient()).get(prefix() + 'session:' + tokenHash);
  if (!raw) return false;
  const session = JSON.parse(raw); return session.userId === userId && session.expires > Date.now();
}
export async function removeSession(tokenHash: string) { if (redisEnabled()) await (await redisClient()).del(prefix() + 'session:' + tokenHash); }
export async function redisRateLimit(key: string, limit: number, period: number) {
  const name = prefix() + 'rate:' + createHash('sha256').update(key).digest('hex');
  const count = await (await redisClient()).eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end;return n", { keys: [name], arguments: [String(period)] });
  return Number(count) <= limit;
}
