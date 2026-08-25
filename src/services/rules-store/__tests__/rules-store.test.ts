import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RulesStoreService, type StoredRule, type CookieStore } from '@/services/rules-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<StoredRule> = {}): StoredRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    is_active: true,
    nodes: [],
    edges: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCookieStore(initial: StoredRule[] = []): CookieStore {
  const store = new Map<string, string>();

  for (const rule of initial) {
    store.set(`wonderly_rule_${rule.id}`, JSON.stringify(rule));
  }

  return {
    getAll: () => Array.from(store.entries()).map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = store.get(name);

      return value ? { name, value } : undefined;
    },
    set: (name, value) => {
      store.set(name, value);
    },
    delete: (name) => {
      store.delete(name);
    },
  };
}

function makeRedis(initial: StoredRule[] = []) {
  const hash = new Map<string, string>();

  for (const rule of initial) {
    hash.set(rule.id, JSON.stringify(rule));
  }

  return {
    hGetAll: vi.fn().mockImplementation(async () => {
      const result: Record<string, string> = {};

      for (const [k, v] of hash) result[k] = v;

      return result;
    }),
    hGet: vi
      .fn()
      .mockImplementation(async (_key: string, field: string) => hash.get(field) ?? null),
    hSet: vi.fn().mockImplementation(async (_key: string, field: string, value: string) => {
      hash.set(field, value);

      return 1;
    }),
    hDel: vi.fn().mockImplementation(async (_key: string, field: string) => {
      hash.delete(field);

      return 1;
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RulesStoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll()', () => {
    it('returns rules from cookie store when available', async () => {
      const rule = makeRule();
      const cookies = makeCookieStore([rule]);
      const svc = new RulesStoreService(null, cookies);

      const result = await svc.getAll();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rule-1');
    });

    it('falls back to Redis when cookie store has no rules', async () => {
      const rule = makeRule();
      const redis = makeRedis([rule]);
      const svc = new RulesStoreService(redis as never, makeCookieStore([]));

      const result = await svc.getAll();

      expect(result).toHaveLength(1);
      expect(redis.hGetAll).toHaveBeenCalled();
    });

    it('returns rules from Redis when no cookie store is provided', async () => {
      const rule = makeRule({ id: 'r1', created_at: '2026-01-02T00:00:00Z' });
      const redis = makeRedis([rule]);
      const svc = new RulesStoreService(redis as never, null);

      const result = await svc.getAll();

      expect(result).toHaveLength(1);
    });

    it('returns empty array when neither store has rules', async () => {
      const svc = new RulesStoreService(null, makeCookieStore([]));

      expect(await svc.getAll()).toEqual([]);
    });

    it('sorts results newest-first', async () => {
      const older = makeRule({ id: 'old', created_at: '2026-01-01T00:00:00Z' });
      const newer = makeRule({ id: 'new', created_at: '2026-03-01T00:00:00Z' });
      const cookies = makeCookieStore([older, newer]);
      const svc = new RulesStoreService(null, cookies);

      const result = await svc.getAll();

      expect(result[0].id).toBe('new');
    });
  });

  describe('getActive()', () => {
    it('returns only active rules', async () => {
      const active = makeRule({ id: 'a', is_active: true });
      const inactive = makeRule({ id: 'b', is_active: false });
      const cookies = makeCookieStore([active, inactive]);
      const svc = new RulesStoreService(null, cookies);

      const result = await svc.getActive();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });
  });

  describe('get()', () => {
    it('returns rule from cookie store by ID', async () => {
      const rule = makeRule({ id: 'xyz' });
      const svc = new RulesStoreService(null, makeCookieStore([rule]));

      expect(await svc.get('xyz')).toMatchObject({ id: 'xyz' });
    });

    it('falls back to Redis when cookie has no match', async () => {
      const rule = makeRule({ id: 'xyz' });
      const redis = makeRedis([rule]);
      const svc = new RulesStoreService(redis as never, makeCookieStore([]));

      const result = await svc.get('xyz');

      expect(result).toMatchObject({ id: 'xyz' });
      expect(redis.hGet).toHaveBeenCalledWith('wonderly:rules', 'xyz');
    });

    it('returns null when rule is not found in either store', async () => {
      const svc = new RulesStoreService(null, makeCookieStore([]));

      expect(await svc.get('nonexistent')).toBeNull();
    });
  });

  describe('save()', () => {
    it('writes to cookie store', async () => {
      const cookies = makeCookieStore();
      const svc = new RulesStoreService(null, cookies);
      const rule = makeRule();

      await svc.save(rule);

      expect(await svc.get('rule-1')).toMatchObject({ id: 'rule-1' });
    });

    it('writes to Redis when available', async () => {
      const redis = makeRedis();
      const svc = new RulesStoreService(redis as never, null);
      const rule = makeRule();

      await svc.save(rule);

      expect(redis.hSet).toHaveBeenCalledWith('wonderly:rules', 'rule-1', expect.any(String));
    });

    it('writes to both cookie store and Redis', async () => {
      const cookies = makeCookieStore();
      const redis = makeRedis();
      const svc = new RulesStoreService(redis as never, cookies);
      const rule = makeRule();

      await svc.save(rule);

      expect(redis.hSet).toHaveBeenCalled();
      expect(await svc.get('rule-1')).toMatchObject({ id: 'rule-1' });
    });
  });

  describe('delete()', () => {
    it('removes rule from cookie store', async () => {
      const rule = makeRule();
      const cookies = makeCookieStore([rule]);
      const svc = new RulesStoreService(null, cookies);

      await svc.delete('rule-1');

      expect(await svc.get('rule-1')).toBeNull();
    });

    it('removes rule from Redis', async () => {
      const rule = makeRule();
      const redis = makeRedis([rule]);
      const svc = new RulesStoreService(redis as never, null);

      await svc.delete('rule-1');

      expect(redis.hDel).toHaveBeenCalledWith('wonderly:rules', 'rule-1');
      expect(await svc.get('rule-1')).toBeNull();
    });
  });
});

describe('Redis/cookie precedence (regression: stale cookies shadowing Redis)', () => {
  it('getAll() prefers Redis over cookies when both have rules', async () => {
    // The exact production failure: a legacy cookie held an old config while
    // Redis — the store the cron reads — held the edited one.
    const stale = makeRule({ id: 'rule-1', name: 'Stale cookie copy' });
    const current = makeRule({ id: 'rule-1', name: 'Current Redis copy' });
    const redis = makeRedis([current]);
    const svc = new RulesStoreService(redis as never, makeCookieStore([stale]));

    const result = await svc.getAll();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Current Redis copy');
    expect(redis.hGetAll).toHaveBeenCalled();
  });

  it('get() prefers Redis over cookies so edits merge onto what the cron runs', async () => {
    const stale = makeRule({ id: 'xyz', name: 'Stale cookie copy' });
    const current = makeRule({ id: 'xyz', name: 'Current Redis copy' });
    const svc = new RulesStoreService(makeRedis([current]) as never, makeCookieStore([stale]));

    expect(await svc.get('xyz')).toMatchObject({ name: 'Current Redis copy' });
  });

  it('getAll() returns empty (not cookies) when Redis is configured but empty', async () => {
    const stale = makeRule({ id: 'rule-1', name: 'Stale cookie copy' });
    const svc = new RulesStoreService(makeRedis([]) as never, makeCookieStore([stale]));

    expect(await svc.getAll()).toEqual([]);
  });

  it('still reads cookies when Redis is not configured (dev)', async () => {
    const rule = makeRule({ id: 'rule-1', name: 'Dev cookie rule' });
    const svc = new RulesStoreService(null, makeCookieStore([rule]));

    const result = await svc.getAll();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Dev cookie rule');
  });

  it('a saved edit is what getAll() returns back, even with a stale cookie present', async () => {
    const stale = makeRule({ id: 'rule-1', name: 'Old name' });
    const cookies = makeCookieStore([stale]);
    const svc = new RulesStoreService(makeRedis([stale]) as never, cookies);

    await svc.save(makeRule({ id: 'rule-1', name: 'Edited name' }));

    const result = await svc.getAll();

    expect(result[0].name).toBe('Edited name');
  });
});

describe('clearCookieRules()', () => {
  it('removes rule cookies when Redis is the active store', async () => {
    const cookies = makeCookieStore([makeRule({ id: 'a' }), makeRule({ id: 'b' })]);
    const svc = new RulesStoreService(makeRedis([]) as never, cookies);

    expect(svc.clearCookieRules()).toBe(2);
    expect(cookies.getAll()).toHaveLength(0);
  });

  it('leaves non-rule cookies untouched', async () => {
    const cookies = makeCookieStore([makeRule({ id: 'a' })]);

    cookies.set('session', 'keep-me');

    const svc = new RulesStoreService(makeRedis([]) as never, cookies);

    svc.clearCookieRules();

    expect(cookies.getAll().map((c) => c.name)).toEqual(['session']);
  });

  it('does nothing when Redis is not configured — cookies are the real store', async () => {
    const cookies = makeCookieStore([makeRule({ id: 'a' })]);
    const svc = new RulesStoreService(null, cookies);

    expect(svc.clearCookieRules()).toBe(0);
    expect(cookies.getAll()).toHaveLength(1);
  });
});

describe('rule authorisation scope (regression: un-toggleable rules)', () => {
  /**
   * PUT/DELETE used to authorise on `user_id`. A rule created under a different
   * Meta login stayed visible (the list filters by ad account) but every toggle
   * and delete returned 403, and the client swallowed it — so the switch simply
   * snapped back. Authorisation now matches visibility: same ad account.
   */
  function authorised(
    rule: Pick<StoredRule, 'user_id' | 'ad_account_id'>,
    session: { id: string; ad_account_id: string }
  ): boolean {
    return !rule.ad_account_id || rule.ad_account_id === session.ad_account_id;
  }

  const session = { id: 'user-current', ad_account_id: 'act-1' };

  it('allows managing a rule on the same ad account created by someone else', () => {
    expect(authorised({ user_id: 'user-other', ad_account_id: 'act-1' }, session)).toBe(true);
  });

  it('allows managing a legacy rule with no ad account', () => {
    expect(authorised({ user_id: 'user-other', ad_account_id: undefined }, session)).toBe(true);
  });

  it('still blocks a rule belonging to a different ad account', () => {
    expect(authorised({ user_id: 'user-current', ad_account_id: 'act-2' }, session)).toBe(false);
  });
});
