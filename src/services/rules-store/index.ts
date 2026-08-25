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
import type { StoredRule, CookieStore } from './types';

export type { StoredRule, CookieStore };

export class RulesStoreService {
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
    // Redis is the single source of truth whenever it is configured — it is the
    // only store `save()` writes to, and the only one the cron can read. Reading
    // cookies first here (as this used to) let a stale cookie shadow Redis
    // forever: the UI showed one config while the cron executed another.
    if (this.redis) {
      try {
        const data = await this.redis.hGetAll(RULES_REDIS_HASH_KEY);

        if (!data || Object.keys(data).length === 0) return [];

        const rules = Object.values(data).map((v) => JSON.parse(v) as StoredRule);

        return rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      } catch (e) {
        this.logger.error('Redis read error', e);
      }

      return [];
    }

    return this.getAllFromCookies();
  }

  /**
   * Read rules from the cookie store. Only used when Redis is unavailable
   * (local dev without `REDIS_URL`), and by `clearCookieRules()`.
   */
  private getAllFromCookies(): StoredRule[] {
    if (!this.cookieStore) return [];

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

    return rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  /**
   * Delete any leftover rule cookies. Call this when Redis is the active store
   * so legacy cookies — written before Redis was configured, or during a Redis
   * outage — cannot shadow it if the read order ever regresses.
   *
   * @returns Number of rule cookies removed
   */
  clearCookieRules(): number {
    if (!this.cookieStore || !this.redis) return 0;

    let cleared = 0;

    for (const cookie of this.cookieStore.getAll()) {
      if (cookie.name.startsWith(RULE_COOKIE_PREFIX)) {
        try {
          this.cookieStore.delete(cookie.name);
          cleared++;
        } catch {
          /* cookie mutation is not always permitted — best effort */
        }
      }
    }

    if (cleared > 0) this.logger.info('Cleared stale rule cookies', { cleared });

    return cleared;
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
    // Redis first, for the same reason as getAll(): an edit must merge onto the
    // version the cron will actually run, not onto a stale cookie copy.
    if (this.redis) {
      try {
        const data = await this.redis.hGet(RULES_REDIS_HASH_KEY, ruleId);

        return data ? (JSON.parse(data) as StoredRule) : null;
      } catch (e) {
        this.logger.error('Redis read error', e);
      }

      return null;
    }

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

    return null;
  }

  /**
   * Save a rule. Writes to Redis when available; falls back to cookies in dev
   * (no Redis). Never writes rule cookies when Redis is connected — rule JSON
   * is large enough that cookie accumulation triggers Vercel's 494 header limit.
   *
   * @param rule - Rule to persist
   */
  async save(rule: StoredRule): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.hSet(RULES_REDIS_HASH_KEY, rule.id, JSON.stringify(rule));
      } catch (e) {
        this.logger.error('Redis write error', e);
      }

      return;
    }

    // Cookie-only fallback for dev without Redis
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
  }

  /**
   * Delete a rule. Removes from Redis when available, otherwise removes from cookies.
   *
   * @param ruleId - ID of the rule to delete
   */
  async delete(ruleId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.hDel(RULES_REDIS_HASH_KEY, ruleId);
      } catch (e) {
        this.logger.error('Redis delete error', e);
      }

      return;
    }

    if (this.cookieStore) {
      try {
        this.cookieStore.delete(`${RULE_COOKIE_PREFIX}${ruleId}`);
      } catch (e) {
        this.logger.error('Cookie delete error', e);
      }
    }
  }
}
