/**
 * Redis connection singleton.
 *
 * Caches a single connected client at module level so every call to
 * `getRedisClient()` reuses the same connection. The client is never
 * explicitly disconnected — the serverless instance manages its lifetime.
 */

import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '@/services/logger';

const logger = createLogger('Redis');

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

/**
 * Return a connected Redis client, or `null` if `REDIS_URL` is not set
 * or the connection fails.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;

  if (client?.isOpen) return client;

  // Avoid multiple parallel connection attempts
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = createClient({ url: process.env.REDIS_URL }) as RedisClientType;

      c.on('error', (err) => {
        logger.error('Redis client error', err);
        client = null;
      });

      await c.connect();
      client = c;

      return client;
    } catch (error) {
      logger.error('Redis connection failed', error);
      client = null;

      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}
