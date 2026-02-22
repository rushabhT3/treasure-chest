import { redis, acquireLock, releaseLock } from '../config/redis';
import { logger } from './logger';

/**
 * DEADLOCK PREVENTION STRATEGY:
 * 1. Consistent Ordering: All resources locked in ascending UUID order
 * 2. Distributed Locks: Redis-based locking with automatic expiration
 * 3. Lock Timeouts: Prevent indefinite blocking
 * 4. Retry Logic: Exponential backoff on lock acquisition failure
 */
export class DeadlockPreventer {
  /**
   * Sort IDs to ensure consistent locking order across all transactions
   */
  static sortIds(...ids: string[]): string[] {
    return [...ids].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Execute operation with ordered distributed locks
   */
  static async withOrderedLocks<T>(
    walletIds: string[],
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    const sortedIds = this.sortIds(...walletIds);
    const locks: { id: string; token: string }[] = [];
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        // Phase 1: Acquire all locks in strict order
        for (const id of sortedIds) {
          const token = await acquireLock(`wallet:${id}`, 30);
          if (!token) {
            throw new Error(`Failed to acquire lock for wallet ${id}`);
          }
          locks.push({ id, token });
          logger.debug(`🔒 Acquired lock for wallet ${id}`);
        }

        // Phase 2: Execute operation
        const result = await operation();

        // Phase 3: Release locks in reverse order (LIFO)
        for (const { id, token } of locks.reverse()) {
          await releaseLock(`wallet:${id}`, token);
          logger.debug(`🔓 Released lock for wallet ${id}`);
        }

        return result;
      } catch (error) {
        // Release any acquired locks before retry
        for (const { id, token } of locks) {
          await releaseLock(`wallet:${id}`, token);
        }
        
        attempt++;
        if (attempt >= maxRetries) throw error;
        
        // Exponential backoff: 100ms, 200ms, 400ms
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        logger.warn(`🔄 Retry ${attempt}/${maxRetries} for wallets: ${sortedIds.join(', ')}`);
      }
    }

    throw new Error('Max retries exceeded');
  }
}
