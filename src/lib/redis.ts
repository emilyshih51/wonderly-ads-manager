/**
 * Redis connection helper.
 *
 * Creates and connects a Redis client when `REDIS_URL` is configured.
 * Returns `null` in environments where Redis is not available (e.g. local dev
 * without a Redis instance), allowing callers to gracefully degrade to
 * cookie-only storage.
 *
 * @example
 * ```ts
 * const redis = await getRedisClient();
 * const store = new RulesStoreService(redis); // null → cookie-only mode
 * ```
 */

import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '@/services/logger';

const logger = createLogger('Redis');

/**
 * Create and connect a Redis client using the `REDIS_URL` environment variable.
 *
 * @returns A connected `RedisClientType`, or `null` if `REDIS_URL` is not set
 *          or the connection fails.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;

  try {
    const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;

    await client.connect();

    return client;
  } catch (error) {
    logger.error('Redis connection failed', error);

    return null;
  }
}
