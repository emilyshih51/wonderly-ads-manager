import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatMemoryService, type StoredMessage } from '@/services/chat-memory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeRedis(initial: StoredMessage[] = []) {
  // Store newest-first (like LPUSH would)
  const list = initial.map((m) => JSON.stringify(m)).reverse();

  const multiChain = {
    lPush: vi.fn().mockReturnThis(),
    lTrim: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  return {
    lRange: vi.fn().mockImplementation(async () => [...list]),
    lPush: vi.fn().mockImplementation(async (_key: string, value: string) => {
      list.unshift(value);

      return list.length;
    }),
    lTrim: vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(true),
    del: vi.fn().mockResolvedValue(1),
    multi: vi.fn().mockReturnValue(multiChain),
    _multiChain: multiChain,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChatMemoryService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let service: ChatMemoryService;

  beforeEach(() => {
    redis = makeRedis();
    service = new ChatMemoryService(redis as never);
  });

  describe('getHistory', () => {
    it('returns empty array when Redis is null', async () => {
      const nullService = new ChatMemoryService(null);
      const result = await nullService.getHistory('user-1');

      expect(result).toEqual([]);
    });

    it('returns parsed messages in chronological order', async () => {
      const msg1 = makeMessage({ content: 'First', timestamp: 1000 });
      const msg2 = makeMessage({ role: 'assistant', content: 'Second', timestamp: 2000 });

      redis = makeRedis([msg1, msg2]);
      service = new ChatMemoryService(redis as never);

      const result = await service.getHistory('user-1');

      expect(result).toEqual([msg1, msg2]);
      expect(redis.lRange).toHaveBeenCalledWith('chat:memory:user-1', 0, -1);
    });

    it('skips malformed entries', async () => {
      redis.lRange.mockResolvedValue([
        'not-json',
        JSON.stringify(makeMessage({ content: 'Valid' })),
      ]);
      const result = await service.getHistory('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Valid');
    });

    it('returns empty array on Redis error', async () => {
      redis.lRange.mockRejectedValue(new Error('Connection lost'));
      const result = await service.getHistory('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('appendMessage', () => {
    it('does nothing when Redis is null', async () => {
      const nullService = new ChatMemoryService(null);

      await expect(nullService.appendMessage('user-1', makeMessage())).resolves.toBeUndefined();
    });

    it('pipelines LPUSH, LTRIM, and EXPIRE via multi', async () => {
      const msg = makeMessage({ content: 'Test' });

      await service.appendMessage('user-1', msg);

      expect(redis.multi).toHaveBeenCalled();
      expect(redis._multiChain.lPush).toHaveBeenCalledWith(
        'chat:memory:user-1',
        JSON.stringify(msg)
      );
      expect(redis._multiChain.lTrim).toHaveBeenCalledWith('chat:memory:user-1', 0, 49);
      expect(redis._multiChain.expire).toHaveBeenCalledWith('chat:memory:user-1', 60 * 60 * 24 * 7);
      expect(redis._multiChain.exec).toHaveBeenCalled();
    });

    it('does not throw on Redis error', async () => {
      redis._multiChain.exec.mockRejectedValue(new Error('Connection lost'));

      await expect(service.appendMessage('user-1', makeMessage())).resolves.toBeUndefined();
    });
  });

  describe('clearHistory', () => {
    it('does nothing when Redis is null', async () => {
      const nullService = new ChatMemoryService(null);

      await expect(nullService.clearHistory('user-1')).resolves.toBeUndefined();
    });

    it('calls DEL with correct key', async () => {
      await service.clearHistory('user-1');

      expect(redis.del).toHaveBeenCalledWith('chat:memory:user-1');
    });

    it('does not throw on Redis error', async () => {
      redis.del.mockRejectedValue(new Error('Connection lost'));

      await expect(service.clearHistory('user-1')).resolves.toBeUndefined();
    });
  });
});
