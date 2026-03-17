/**
 * Persistent rules store.
 *
 * Storage strategy:
 * 1. If REDIS_URL is configured → uses Redis (persistent, works for cron)
 * 2. Always also reads/writes cookies as fallback (works immediately, no setup needed)
 *
 * The cron job reads from Redis (no cookies available). The UI reads from cookies.
 * When Redis is available, writes go to BOTH so they stay in sync.
 */

import { cookies } from 'next/headers';
import { createClient, type RedisClientType } from 'redis';

const RULE_PREFIX = 'wonderly_rule_';
const RULES_HASH_KEY = 'wonderly:rules';
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_AVAILABLE = !!REDIS_URL;

// Singleton Redis client
let redisClient: RedisClientType | null = null;
let redisConnecting = false;

async function getRedis(): Promise<RedisClientType | null> {
  if (!REDIS_AVAILABLE) return null;
  if (redisClient?.isOpen) return redisClient;
  if (redisConnecting) return null; // Avoid concurrent connection attempts

  try {
    redisConnecting = true;
    redisClient = createClient({ url: REDIS_URL }) as RedisClientType;
    redisClient.on('error', (err) => console.error('[Redis] Client error:', err));
    await redisClient.connect();
    redisConnecting = false;
    return redisClient;
  } catch (e) {
    console.error('[Redis] Connection error:', e);
    redisConnecting = false;
    redisClient = null;
    return null;
  }
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  };
}

export interface StoredRule {
  id: string;
  user_id?: string;
  name: string;
  is_active: boolean;
  nodes: any[];
  edges: any[];
  created_at: string;
  updated_at: string;
}

/**
 * Get all rules — reads from cookies (always available in user requests)
 * Falls back to Redis for cron jobs (no cookies)
 */
export async function getAllRules(): Promise<StoredRule[]> {
  // Try cookies first (works in user requests)
  try {
    const cookieStore = await cookies();
    const rules: StoredRule[] = [];
    for (const cookie of cookieStore.getAll()) {
      if (cookie.name.startsWith(RULE_PREFIX)) {
        try {
          rules.push(JSON.parse(cookie.value));
        } catch { /* skip malformed */ }
      }
    }
    if (rules.length > 0) {
      rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return rules;
    }
  } catch {
    // cookies() may throw in cron context — that's fine, fall through to Redis
  }

  // Fall back to Redis (for cron jobs where cookies aren't available)
  const redis = await getRedis();
  if (redis) {
    try {
      const data = await redis.hGetAll(RULES_HASH_KEY);
      if (!data || Object.keys(data).length === 0) return [];
      const rules = Object.values(data).map((v) => JSON.parse(v)) as StoredRule[];
      rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return rules;
    } catch (e) {
      console.error('[RulesStore] Redis read error:', e);
    }
  }

  return [];
}

/**
 * Get active rules only (used by cron)
 */
export async function getActiveRules(): Promise<StoredRule[]> {
  const all = await getAllRules();
  return all.filter((r) => r.is_active);
}

/**
 * Get a single rule by ID
 */
export async function getRule(ruleId: string): Promise<StoredRule | null> {
  // Try cookie first
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(`${RULE_PREFIX}${ruleId}`);
    if (cookie) return JSON.parse(cookie.value);
  } catch { /* no cookies in cron */ }

  // Fall back to Redis
  const redis = await getRedis();
  if (redis) {
    try {
      const data = await redis.hGet(RULES_HASH_KEY, ruleId);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('[RulesStore] Redis read error:', e);
    }
  }

  return null;
}

/**
 * Save a rule — writes to BOTH cookies and Redis (if available)
 */
export async function saveRule(rule: StoredRule): Promise<void> {
  // Always write to cookies (immediate persistence for user)
  try {
    const cookieStore = await cookies();
    cookieStore.set(`${RULE_PREFIX}${rule.id}`, JSON.stringify(rule), getCookieOptions());
  } catch (e) {
    console.error('[RulesStore] Cookie write error:', e);
  }

  // Also write to Redis if available (for cron access)
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.hSet(RULES_HASH_KEY, rule.id, JSON.stringify(rule));
    } catch (e) {
      console.error('[RulesStore] Redis write error:', e);
    }
  }
}

/**
 * Delete a rule — removes from BOTH cookies and Redis
 */
export async function deleteRule(ruleId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(`${RULE_PREFIX}${ruleId}`);
  } catch (e) {
    console.error('[RulesStore] Cookie delete error:', e);
  }

  const redis = await getRedis();
  if (redis) {
    try {
      await redis.hDel(RULES_HASH_KEY, ruleId);
    } catch (e) {
      console.error('[RulesStore] Redis delete error:', e);
    }
  }
}

/**
 * Check if Redis is configured
 */
export function isKvConfigured(): boolean {
  return REDIS_AVAILABLE;
}
