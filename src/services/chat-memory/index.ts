/**
 * ChatMemoryService — Redis-backed conversation memory for the web chat.
 *
 * Stores per-user message history as a capped Redis list so Claude has context
 * from previous conversations and users can see their chat history on reload.
 *
 * @example
 * ```ts
 * const redis = await getRedisClient();
 * const memory = new ChatMemoryService(redis);
 * await memory.appendMessage(userId, { role: 'user', content: 'Hello', timestamp: Date.now() });
 * const history = await memory.getHistory(userId);
 * ```
 */

import { type RedisClientType } from 'redis';
import { createLogger } from '@/services/logger';

const logger = createLogger('ChatMemory');

/** Maximum number of messages stored per user. */
const MAX_MESSAGES = 50;

/** TTL in seconds — 7 days. Refreshed on every append. */
const TTL_SECONDS = 60 * 60 * 24 * 7;

/** A single stored chat message. */
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Builds the Redis key for a user's chat memory.
 *
 * @param userId - Meta user ID from the session
 */
function redisKey(userId: string): string {
  return `chat:memory:${userId}`;
}

export class ChatMemoryService {
  constructor(private readonly redis: RedisClientType | null = null) {}

  /**
   * Returns the full message history for a user, oldest-first.
   *
   * @param userId - Meta user ID
   * @returns Array of stored messages (empty if Redis unavailable or no history)
   */
  async getHistory(userId: string): Promise<StoredMessage[]> {
    if (!this.redis) return [];

    try {
      const raw = await this.redis.lRange(redisKey(userId), 0, -1);
      const messages: StoredMessage[] = [];

      for (const entry of raw) {
        try {
          messages.push(JSON.parse(entry));
        } catch {
          logger.warn('Skipping malformed chat memory entry');
        }
      }

      // Redis list is newest-first (LPUSH), reverse for chronological order
      return messages.reverse();
    } catch (error) {
      logger.error('Failed to read chat memory', error);

      return [];
    }
  }

  /**
   * Appends a message to the user's chat history.
   * Caps the list at {@link MAX_MESSAGES} and refreshes the TTL.
   *
   * @param userId - Meta user ID
   * @param message - Message to store
   */
  async appendMessage(userId: string, message: StoredMessage): Promise<void> {
    if (!this.redis) return;

    try {
      const key = redisKey(userId);

      await this.redis.lPush(key, JSON.stringify(message));
      await this.redis.lTrim(key, 0, MAX_MESSAGES - 1);
      await this.redis.expire(key, TTL_SECONDS);
    } catch (error) {
      logger.error('Failed to append chat memory', error);
    }
  }

  /**
   * Clears all chat history for a user.
   *
   * @param userId - Meta user ID
   */
  async clearHistory(userId: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(redisKey(userId));
    } catch (error) {
      logger.error('Failed to clear chat memory', error);
    }
  }
}
