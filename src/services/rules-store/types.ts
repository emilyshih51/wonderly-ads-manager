import type { AutomationNode, AutomationEdge } from '@/types';

/** An automation rule as persisted in Redis and session cookies. */
export interface StoredRule {
  /** Unique rule ID (UUID). */
  id: string;
  /** ID of the user who owns this rule. */
  user_id?: string;
  /** Ad account ID this rule operates on. */
  ad_account_id?: string;
  /** Human-readable rule name shown in the UI. */
  name: string;
  /** Whether this rule is currently evaluated by the cron job. */
  is_active: boolean;
  /** Flow nodes (triggers, conditions, actions) that make up the rule. */
  nodes: AutomationNode[];
  /** Directed edges connecting the flow nodes. */
  edges: AutomationEdge[];
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-updated timestamp. */
  updated_at: string;
}

/**
 * Minimal interface for a cookie store, compatible with the Next.js `cookies()` API.
 * Using an interface keeps the service testable without importing Next.js internals.
 */
export interface CookieStore {
  /** Return all cookies as name/value pairs. */
  getAll(): Array<{ name: string; value: string }>;
  /** Return a single cookie by name, or `undefined` if absent. */
  get(name: string): { name: string; value: string } | undefined;
  /** Set a cookie with optional configuration (max-age, path, etc.). */
  set(name: string, value: string, options?: Record<string, unknown>): void;
  /** Delete a cookie by name. */
  delete(name: string): void;
}

/** Contract for the rules-store service. */
export interface IRulesStoreService {
  /** Return all stored rules for the current user. */
  getAll(): Promise<StoredRule[]>;
  /** Return only rules where `is_active` is `true`. */
  getActive(): Promise<StoredRule[]>;
  /** Return a single rule by ID, or `null` if not found. */
  get(ruleId: string): Promise<StoredRule | null>;
  /** Create or update a rule (upsert by `id`). */
  save(rule: StoredRule): Promise<void>;
  /** Permanently delete a rule by ID. */
  delete(ruleId: string): Promise<void>;
}
