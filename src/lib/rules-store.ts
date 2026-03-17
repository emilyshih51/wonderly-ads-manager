/**
 * Persistent rules store.
 *
 * Storage strategy:
 * 1. If Vercel KV is configured → uses KV (persistent Redis, works for cron)
 * 2. Always also reads/writes cookies as fallback (works immediately, no setup needed)
 *
 * The cron job reads from KV (no cookies available). The UI reads from cookies.
 * When KV is available, writes go to BOTH so they stay in sync.
 */

import { cookies } from 'next/headers';

const RULE_PREFIX = 'wonderly_rule_';

// KV imports — only used if env vars are set
let kvModule: any = null;
const KV_AVAILABLE = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const RULES_KEY = 'wonderly:rules';

async function getKv() {
  if (!KV_AVAILABLE) return null;
  if (!kvModule) {
    try {
      kvModule = await import('@vercel/kv');
    } catch {
      return null;
    }
  }
  return kvModule.kv;
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
 * Falls back to KV for cron jobs (no cookies)
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
    // cookies() may throw in cron context — that's fine, fall through to KV
  }

  // Fall back to KV (for cron jobs where cookies aren't available)
  const kv = await getKv();
  if (kv) {
    try {
      const data = await kv.hgetall(RULES_KEY);
      if (!data) return [];
      const rules = Object.values(data) as StoredRule[];
      rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return rules;
    } catch (e) {
      console.error('[RulesStore] KV read error:', e);
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

  // Fall back to KV
  const kv = await getKv();
  if (kv) {
    try {
      const rule = await kv.hget(RULES_KEY, ruleId);
      return (rule as StoredRule) || null;
    } catch (e) {
      console.error('[RulesStore] KV read error:', e);
    }
  }

  return null;
}

/**
 * Save a rule — writes to BOTH cookies and KV (if available)
 */
export async function saveRule(rule: StoredRule): Promise<void> {
  // Always write to cookies (immediate persistence for user)
  try {
    const cookieStore = await cookies();
    cookieStore.set(`${RULE_PREFIX}${rule.id}`, JSON.stringify(rule), getCookieOptions());
  } catch (e) {
    console.error('[RulesStore] Cookie write error:', e);
  }

  // Also write to KV if available (for cron access)
  const kv = await getKv();
  if (kv) {
    try {
      await kv.hset(RULES_KEY, { [rule.id]: rule });
    } catch (e) {
      console.error('[RulesStore] KV write error:', e);
    }
  }
}

/**
 * Delete a rule — removes from BOTH cookies and KV
 */
export async function deleteRule(ruleId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(`${RULE_PREFIX}${ruleId}`);
  } catch (e) {
    console.error('[RulesStore] Cookie delete error:', e);
  }

  const kv = await getKv();
  if (kv) {
    try {
      await kv.hdel(RULES_KEY, ruleId);
    } catch (e) {
      console.error('[RulesStore] KV delete error:', e);
    }
  }
}

/**
 * Check if KV is configured
 */
export function isKvConfigured(): boolean {
  return KV_AVAILABLE;
}
