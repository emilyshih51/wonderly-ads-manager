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
