/**
 * OpenAIService — minimal wrapper around OpenAI's Chat Completions API, used by the Slack
 * bot when `SLACK_BOT_AI_PROVIDER=openai` (see `src/app/api/slack/events/route.ts`).
 *
 * Same `complete()` shape as `AnthropicService.complete()` so the bot can swap providers
 * without touching its prompt or action-button parsing. Uses `fetch` directly — no SDK
 * dependency.
 *
 * @example
 * ```ts
 * const ai = new OpenAIService(process.env.OPENAI_API_KEY!, process.env.OPENAI_MODEL);
 * const text = await ai.complete({ message, systemPrompt: SYSTEM_PROMPT, context, history });
 * ```
 */

import type { CompletionParams } from '@/services/anthropic/types';

/** Default model when `OPENAI_MODEL` isn't set. Override in Vercel if this gets retired. */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-astra';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MAX_TOKENS = 4000;

/** Error from the OpenAI API, carrying the HTTP status and OpenAI's own error code. */
export class OpenAIApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'OpenAIApiError';
  }
}

export class OpenAIService {
  private readonly model: string;

  /**
   * @param apiKey - OpenAI API key (`OPENAI_API_KEY`)
   * @param model - Model ID override (defaults to {@link DEFAULT_OPENAI_MODEL})
   * @param fetchFn - Injected for tests
   */
  constructor(
    private readonly apiKey: string,
    model?: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    this.model = model?.trim() || DEFAULT_OPENAI_MODEL;
  }

  /**
   * Get a complete (non-streaming) text response.
   *
   * @throws {OpenAIApiError} When OpenAI returns an error or no text
   */
  async complete(params: CompletionParams): Promise<string> {
    const { message, systemPrompt, context, history = [] } = params;

    const response = await this.fetchFn(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: DEFAULT_MAX_TOKENS,
        messages: [
          { role: 'system', content: `${systemPrompt}\n\n${context ?? 'No data available.'}` },
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: message },
        ],
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string; code?: string; type?: string };
    };

    if (!response.ok || data.error) {
      throw new OpenAIApiError(
        data.error?.message || `OpenAI API error ${response.status}`,
        response.status,
        data.error?.code ?? data.error?.type
      );
    }

    const text = data.choices?.[0]?.message?.content;

    if (!text) throw new OpenAIApiError('OpenAI response contained no text', response.status);

    return text;
  }
}
