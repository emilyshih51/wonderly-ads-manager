import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStream = {
  [Symbol.asyncIterator]: () => {
    const events = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
    ];
    let i = 0;

    return {
      next: async () =>
        i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true },
    };
  },
};

const mockMessagesStream = vi.fn().mockResolvedValue(mockStream);
const mockMessagesCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'This is the full response.' }],
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: mockMessagesStream,
      create: mockMessagesCreate,
    };
  }

  return { default: MockAnthropic };
});

import { AnthropicService } from '@/services/anthropic';

describe('AnthropicService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('complete()', () => {
    it('returns the text content from the response', async () => {
      const svc = new AnthropicService('test-api-key');
      const result = await svc.complete({
        message: 'How are my campaigns?',
        systemPrompt: 'You are a media buyer.',
      });

      expect(result).toBe('This is the full response.');
    });

    it('passes system prompt + context combined', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = new (Anthropic as unknown as new () => any)();
      const svc = new AnthropicService('test-api-key');

      await svc.complete({
        message: 'What is my CPA?',
        systemPrompt: 'You are an expert.',
        context: 'Spend: $100, Results: 5',
      });

      expect(instance.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are an expert.\n\nSpend: $100, Results: 5',
        })
      );
    });

    it('includes history in the messages array', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = new (Anthropic as unknown as new () => any)();
      const svc = new AnthropicService('test-api-key');

      await svc.complete({
        message: 'Follow-up question',
        systemPrompt: 'You are an expert.',
        history: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
        ],
      });

      const call = instance.messages.create.mock.calls[0][0];

      expect(call.messages).toHaveLength(3);
      expect(call.messages[0]).toEqual({ role: 'user', content: 'First question' });
      expect(call.messages[2]).toEqual({ role: 'user', content: 'Follow-up question' });
    });
  });

  describe('chat()', () => {
    it('returns a ReadableStream', async () => {
      const svc = new AnthropicService('test-api-key');
      const stream = await svc.chat({
        message: 'Hello',
        systemPrompt: 'You are an expert.',
      });

      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it('emits SSE text deltas then [DONE]', async () => {
      const svc = new AnthropicService('test-api-key');
      const stream = await svc.chat({
        message: 'Hello',
        systemPrompt: 'You are an expert.',
      });

      const reader = stream.getReader();
      const chunks: string[] = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        chunks.push(value as string);
      }

      expect(chunks).toContain('data: {"text":"Hello "}\n\n');
      expect(chunks).toContain('data: {"text":"world"}\n\n');
      expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
    });
  });
});
