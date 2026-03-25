/**
 * UsageTrackerService — tracks Claude API token usage per user per day in Redis.
 *
 * Uses Redis hashes keyed by `chat:usage:{userId}:{YYYY-MM-DD}` with fields
 * `input_tokens` and `output_tokens` (atomically incremented per request).
 * Keys auto-expire after 90 days.
 *
 * @example
 * ```ts
 * const tracker = new UsageTrackerService(redis);
 * await tracker.recordUsage(userId, { input_tokens: 1200, output_tokens: 350 });
 * const today = await tracker.getDailyUsage(userId);
 * ```
 */

import type { RedisClientType } from 'redis';
import { createLogger } from '@/services/logger';

const logger = createLogger('UsageTracker');

const REDIS_KEY_PREFIX = 'chat:usage:';
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

/** Token usage for a single API call. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

/** Aggregated daily usage with cost calculation. */
export interface DailyUsage {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
}

// Anthropic pricing for Claude Sonnet (per million tokens)
const INPUT_COST_PER_MILLION = 3.0;
const OUTPUT_COST_PER_MILLION = 15.0;

/**
 * Calculate estimated cost based on Anthropic's published Claude Sonnet pricing.
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Estimated cost in USD
 */
export function calculateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION
  );
}

export class UsageTrackerService {
  private readonly redis: RedisClientType | null;

  constructor(redis: RedisClientType | null) {
    this.redis = redis;
  }

  /** Build the Redis key for a user's daily usage. */
  private key(userId: string, date?: string): string {
    const d = date ?? new Date().toISOString().slice(0, 10);

    return `${REDIS_KEY_PREFIX}${userId}:${d}`;
  }

  /**
   * Record token usage for a single API call. Atomically increments daily totals.
   * @param userId - User ID
   * @param usage - Token counts from the Anthropic API response
   */
  async recordUsage(userId: string, usage: TokenUsage): Promise<void> {
    if (!this.redis) return;

    try {
      const k = this.key(userId);

      await this.redis.hIncrBy(k, 'input_tokens', usage.input_tokens);
      await this.redis.hIncrBy(k, 'output_tokens', usage.output_tokens);
      await this.redis.expire(k, TTL_SECONDS);
    } catch (e) {
      logger.error('Failed to record usage', e);
    }
  }

  /**
   * Fetch usage for a specific day (defaults to today).
   * @param userId - User ID
   * @param date - Optional date string (YYYY-MM-DD), defaults to today
   * @returns Daily usage with estimated cost
   */
  async getDailyUsage(userId: string, date?: string): Promise<DailyUsage> {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const empty: DailyUsage = {
      date: d,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost: 0,
    };

    if (!this.redis) return empty;

    try {
      const data = await this.redis.hGetAll(this.key(userId, d));

      if (!data || Object.keys(data).length === 0) return empty;

      const input = Number(data.input_tokens) || 0;
      const output = Number(data.output_tokens) || 0;

      return {
        date: d,
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
        estimated_cost: calculateCost(input, output),
      };
    } catch (e) {
      logger.error('Failed to fetch daily usage', e);

      return empty;
    }
  }

  /**
   * Fetch usage for the last N days.
   * @param userId - User ID
   * @param days - Number of days to look back (default 7)
   * @returns Array of daily usage entries, most recent first
   */
  async getUsageHistory(userId: string, days = 7): Promise<DailyUsage[]> {
    const results: DailyUsage[] = [];

    for (let i = 0; i < days; i++) {
      const date = new Date();

      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const usage = await this.getDailyUsage(userId, dateStr);

      results.push(usage);
    }

    return results;
  }
}
