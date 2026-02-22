import { redis } from '../config/redis';
import { logger } from './logger';

const IDEMPOTENCY_TTL = 86400; // 24 hours

export async function checkIdempotency(key: string): Promise<{ exists: boolean; result?: any }> {
  const cached = await redis.get(`idempotency:${key}`);
  if (cached) {
    logger.info(`♻️ Idempotency hit for key: ${key}`);
    return { exists: true, result: JSON.parse(cached) };
  }
  return { exists: false };
}

export async function storeIdempotency(key: string, result: any, ttl: number = IDEMPOTENCY_TTL): Promise<void> {
  await redis.setex(`idempotency:${key}`, ttl, JSON.stringify({
    ...result,
    _idempotencyStored: true,
    _storedAt: new Date().toISOString()
  }));
  logger.debug(`💾 Stored idempotency result for key: ${key}`);
}

export async function markProcessing(key: string, ttl: number = 30): Promise<boolean> {
  const result = await redis.set(`processing:${key}`, '1', 'EX', ttl, 'NX');
  return result === 'OK';
}

export async function unmarkProcessing(key: string): Promise<void> {
  await redis.del(`processing:${key}`);
}
