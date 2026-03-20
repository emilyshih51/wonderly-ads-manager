export interface StoredRule {
  id: string;
  user_id?: string;
  /** Which ad account this rule belongs to */
  ad_account_id?: string;
  name: string;
  is_active: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[];
  created_at: string;
  updated_at: string;
}

/**
 * Minimal interface for a cookie store, compatible with Next.js `cookies()`.
 * Using an interface makes the service testable without importing Next.js internals.
 */
export interface CookieStore {
  getAll(): Array<{ name: string; value: string }>;
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
}

export interface IRulesStoreService {
  getAll(): Promise<StoredRule[]>;
  getActive(): Promise<StoredRule[]>;
  get(ruleId: string): Promise<StoredRule | null>;
  save(rule: StoredRule): Promise<void>;
  delete(ruleId: string): Promise<void>;
}
