export function workerEnvironment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/PASSWORD|SECRET|TOKEN|KEY|^MYSQL_|^REDIS_|^AWS_|^S3_/i.test(key))), NODE_ENV: process.env.NODE_ENV || 'production' };
}
