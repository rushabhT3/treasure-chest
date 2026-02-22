import Redis from 'ioredis';
import { logger } from '../utils/logger';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('connect', () => logger.info('✅ Redis connected'));
redis.on('error', (err) => logger.error('❌ Redis error:', err));
redis.on('reconnecting', () => logger.warn('🔄 Redis reconnecting...'));

export async function acquireLock(key: string, ttlSeconds: number = 30): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const result = await redis.set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
  return result === 'OK' ? token : null;
}

export async function releaseLock(key: string, token: string): Promise<void> {
  const current = await redis.get(`lock:${key}`);
  if (current === token) {
    await redis.del(`lock:${key}`);
  }
}

export async function extendLock(key: string, token: string, ttlSeconds: number): Promise<void> {
  const current = await redis.get(`lock:${key}`);
  if (current === token) {
    await redis.expire(`lock:${key}`, ttlSeconds);
  }
}
