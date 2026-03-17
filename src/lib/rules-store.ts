/**
 * Persistent rules store using Vercel KV (Redis).
 * This allows the cron job to read rules without browser cookies.
 *
 * Setup: Create a KV database in Vercel Dashboard → Storage → Create → KV
 * It auto-adds KV_REST_API_URL and KV_REST_API_TOKEN env vars.
 *
 * If KV is not configured, falls back to an in-memory store (works for dev but
 * won't persist across serverless cold starts in production).
 */

import { kv } from '@vercel/kv';

const RULES_KEY = 'wonderly:rules'; // Single hash key for all rules
const KV_AVAILABLE = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory fallback for development (or when KV isn't configured)
const memoryStore = new Map<string, any>();

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
 * Get all rules
 */
export async function getAllRules(): Promise<StoredRule[]> {
  if (KV_AVAILABLE) {
    try {
      const data = await kv.hgetall(RULES_KEY);
      if (!data) return [];
      const rules = Object.values(data) as StoredRule[];
      rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return rules;
    } catch (e) {
      console.error('[RulesStore] KV read error, falling back to memory:', e);
    }
  }

  // Fallback to memory
  const rules = Array.from(memoryStore.values());
  rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return rules;
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
  if (KV_AVAILABLE) {
    try {
      const rule = await kv.hget(RULES_KEY, ruleId);
      return (rule as StoredRule) || null;
    } catch (e) {
      console.error('[RulesStore] KV read error:', e);
    }
  }
  return memoryStore.get(ruleId) || null;
}

/**
 * Save a rule (create or update)
 */
export async function saveRule(rule: StoredRule): Promise<void> {
  if (KV_AVAILABLE) {
    try {
      await kv.hset(RULES_KEY, { [rule.id]: rule });
      return;
    } catch (e) {
      console.error('[RulesStore] KV write error, falling back to memory:', e);
    }
  }
  memoryStore.set(rule.id, rule);
}

/**
 * Delete a rule
 */
export async function deleteRule(ruleId: string): Promise<void> {
  if (KV_AVAILABLE) {
    try {
      await kv.hdel(RULES_KEY, ruleId);
      return;
    } catch (e) {
      console.error('[RulesStore] KV delete error:', e);
    }
  }
  memoryStore.delete(ruleId);
}

/**
 * Check if KV is configured
 */
export function isKvConfigured(): boolean {
  return KV_AVAILABLE;
}
