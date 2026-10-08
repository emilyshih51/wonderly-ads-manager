import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_OPENAI_MODEL, OpenAIApiError, OpenAIService } from '@/services/openai';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

describe('OpenAIService.complete', () => {
  it('sends system + history + user message and returns the text', async () => {
    const fetchFn = mockFetch(200, { choices: [{ message: { content: 'Hi!' } }] });
    const ai = new OpenAIService('sk-test', undefined, fetchFn as unknown as typeof fetch);

    const text = await ai.complete({
      message: 'How are ads?',
      systemPrompt: 'You are a bot.',
      context: 'DATA',
      history: [{ role: 'assistant', content: 'Earlier reply' }],
    });

    expect(text).toBe('Hi!');
    const [url, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(body.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a bot.\n\nDATA' },
      { role: 'assistant', content: 'Earlier reply' },
      { role: 'user', content: 'How are ads?' },
    ]);
  });

  it('uses the model override', async () => {
    const fetchFn = mockFetch(200, { choices: [{ message: { content: 'ok' } }] });

    await new OpenAIService('k', 'my-model', fetchFn as unknown as typeof fetch).complete({
      message: 'x',
      systemPrompt: 'y',
    });

    expect(JSON.parse(fetchFn.mock.calls[0][1].body).model).toBe('my-model');
  });

  it('throws OpenAIApiError with the code on API errors', async () => {
    const fetchFn = mockFetch(429, {
      error: { message: 'You exceeded your current quota', code: 'insufficient_quota' },
    });
    const ai = new OpenAIService('k', undefined, fetchFn as unknown as typeof fetch);

    await expect(ai.complete({ message: 'x', systemPrompt: 'y' })).rejects.toMatchObject({
      name: 'OpenAIApiError',
      status: 429,
      code: 'insufficient_quota',
    });
    await expect(ai.complete({ message: 'x', systemPrompt: 'y' })).rejects.toBeInstanceOf(
      OpenAIApiError
    );
  });
});
