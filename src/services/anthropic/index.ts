/**
 * AnthropicService — typed wrapper around the Anthropic Messages API.
 *
 * Provides two modes:
 * - `chat()` — streaming response as a `ReadableStream` (SSE), used by the web chat UI
 * - `complete()` — non-streaming, returns the full text response, used by the Slack bot
 *
 * @example
 * ```ts
 * const ai = new AnthropicService(process.env.ANTHROPIC_API_KEY!);
 * const text = await ai.complete({ message: 'How are my campaigns?', systemPrompt: SYSTEM_PROMPT, context });
 * ```
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatParams, CompleteParams, MessageParam } from './types';

export type { ChatParams, CompleteParams, MessageParam };

export enum ClaudeModel {
  Opus4 = 'claude-opus-4-6',
  Sonnet4 = 'claude-sonnet-4-6',
  Sonnet = 'claude-sonnet-4-20250514',
  Haiku4 = 'claude-haiku-4-5-20251001',
}

const DEFAULT_MODEL = ClaudeModel.Sonnet;
const DEFAULT_MAX_TOKENS = 4000;

export class AnthropicService {
  private readonly client: Anthropic;
  private readonly model: string;

  /**
   * @param apiKey - Anthropic API key (`ANTHROPIC_API_KEY`)
   * @param model - Model ID override (defaults to `ClaudeModel.Sonnet`)
   */
  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  /**
   * Start a streaming chat session.
   *
   * Returns a `ReadableStream` that emits Server-Sent Events:
   * `data: {"text": "..."}` for each text delta, then `data: [DONE]`.
   *
   * @param params - Message, system prompt, optional context, and history
   * @returns SSE `ReadableStream` compatible with Next.js streaming responses
   * @throws When the Anthropic API returns an error
   */
  async chat(params: ChatParams): Promise<ReadableStream> {
    const { message, systemPrompt, context, history = [] } = params;

    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: systemPrompt + (context ?? 'No data available.'),
      messages,
    });

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta') {
              const delta = event.delta as { type: string; text?: string };

              if (delta.type === 'text_delta' && delta.text) {
                controller.enqueue(`data: ${JSON.stringify({ text: delta.text })}\n\n`);
              }
            }
          }

          controller.enqueue('data: [DONE]\n\n');
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  /**
   * Get a complete (non-streaming) text response.
   *
   * Used by the Slack bot where the full response is needed before
   * posting back to the thread.
   *
   * @param params - Message, system prompt, optional context, and history
   * @returns Full text response from the model
   * @throws When the Anthropic API returns an error or the response has no text content
   */
  async complete(params: CompleteParams): Promise<string> {
    const { message, systemPrompt, context, history = [] } = params;

    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: systemPrompt + (context ?? 'No data available.'),
      messages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');

    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Anthropic response contained no text content');
    }

    return textBlock.text;
  }
}
