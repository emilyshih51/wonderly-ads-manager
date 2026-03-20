/**
 * RulesStoreService — typed wrapper around the Redis-backed automation rules store.
 *
 * Handles CRUD for automation rules with dual-write to Redis (for cron) and an
 * optional cookie store (for user requests). When no Redis client is provided the
 * service operates in cookie-only mode.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 * const store = new RulesStoreService(redis);
 * const rules = await store.getAll();
 * ```
 */

import { type RedisClientType } from 'redis';
import { createLogger } from '@/services/logger';
import { RULE_COOKIE_PREFIX, RULES_REDIS_HASH_KEY, RULE_COOKIE_MAX_AGE } from './constants';
import type { StoredRule, CookieStore, IRulesStoreService } from './types';

export type { StoredRule, CookieStore, IRulesStoreService };

export class RulesStoreService implements IRulesStoreService {
  private readonly logger = createLogger('RulesStore');

  constructor(
    private readonly redis: RedisClientType | null = null,
    private readonly cookieStore: CookieStore | null = null
  ) {}

  /**
   * Get all rules, sorted by creation date descending.
   *
   * Reads from the cookie store first (available in user requests), then falls back
   * to Redis (available in cron jobs where cookies are not set).
   *
   * @returns All rules sorted newest-first
   */
  async getAll(): Promise<StoredRule[]> {
    if (this.cookieStore) {
      const rules: StoredRule[] = [];

      for (const cookie of this.cookieStore.getAll()) {
        if (cookie.name.startsWith(RULE_COOKIE_PREFIX)) {
          try {
            rules.push(JSON.parse(cookie.value) as StoredRule);
          } catch {
            /* skip malformed */
          }
        }
      }

      if (rules.length > 0) {
        return rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      }
    }

    if (this.redis) {
      try {
        const data = await this.redis.hGetAll(RULES_REDIS_HASH_KEY);

        if (!data || Object.keys(data).length === 0) return [];

        const rules = Object.values(data).map((v) => JSON.parse(v) as StoredRule);

        return rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      } catch (e) {
        this.logger.error('Redis read error', e);
      }
    }

    return [];
  }

  /**
   * Get only active rules (is_active === true).
   * Used by the cron job to find rules to evaluate.
   *
   * @returns Active rules sorted newest-first
   */
  async getActive(): Promise<StoredRule[]> {
    const all = await this.getAll();

    return all.filter((r) => r.is_active);
  }

  /**
   * Get a single rule by ID.
   *
   * Checks the cookie store first, then Redis.
   *
   * @param ruleId - Rule ID to look up
   * @returns The rule, or `null` if not found
   */
  async get(ruleId: string): Promise<StoredRule | null> {
    if (this.cookieStore) {
      const cookie = this.cookieStore.get(`${RULE_COOKIE_PREFIX}${ruleId}`);

      if (cookie) {
        try {
          return JSON.parse(cookie.value) as StoredRule;
        } catch {
          /* malformed */
        }
      }
    }

    if (this.redis) {
      try {
        const data = await this.redis.hGet(RULES_REDIS_HASH_KEY, ruleId);

        return data ? (JSON.parse(data) as StoredRule) : null;
      } catch (e) {
        this.logger.error('Redis read error', e);
      }
    }

    return null;
  }

  /**
   * Save a rule. Writes to BOTH the cookie store and Redis (when available)
   * so that user requests and cron jobs both see the latest state.
   *
   * @param rule - Rule to persist
   */
  async save(rule: StoredRule): Promise<void> {
    if (this.cookieStore) {
      try {
        this.cookieStore.set(`${RULE_COOKIE_PREFIX}${rule.id}`, JSON.stringify(rule), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: RULE_COOKIE_MAX_AGE,
          path: '/',
        });
      } catch (e) {
        this.logger.error('Cookie write error', e);
      }
    }

    if (this.redis) {
      try {
        await this.redis.hSet(RULES_REDIS_HASH_KEY, rule.id, JSON.stringify(rule));
      } catch (e) {
        this.logger.error('Redis write error', e);
      }
    }
  }

  /**
   * Delete a rule. Removes from BOTH the cookie store and Redis.
   *
   * @param ruleId - ID of the rule to delete
   */
  async delete(ruleId: string): Promise<void> {
    if (this.cookieStore) {
      try {
        this.cookieStore.delete(`${RULE_COOKIE_PREFIX}${ruleId}`);
      } catch (e) {
        this.logger.error('Cookie delete error', e);
      }
    }

    if (this.redis) {
      try {
        await this.redis.hDel(RULES_REDIS_HASH_KEY, ruleId);
      } catch (e) {
        this.logger.error('Redis delete error', e);
      }
    }
  }
}
