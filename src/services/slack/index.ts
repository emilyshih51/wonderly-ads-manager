/**
 * SlackService — typed wrapper around the Slack Web API.
 *
 * Handles message posting, message updates, thread history, and
 * request signature verification. Pure formatting utilities are
 * exposed as static methods so they can be used without credentials.
 *
 * @example
 * ```ts
 * const slack = new SlackService(process.env.SLACK_BOT_TOKEN!, process.env.SLACK_SIGNING_SECRET!);
 * await slack.postMessage('#alerts', 'Hello!');
 * ```
 */

import crypto from 'crypto';
import {
  SLACK_ENDPOINTS,
  SLACK_BLOCK_MAX_CHARS,
  SLACK_MAX_BUTTONS_PER_ROW,
  ACTION_LABEL_MAX_CHARS,
  SLACK_TIMESTAMP_TOLERANCE_SECONDS,
} from './constants';
import type {
  SlackMessage,
  SlackThreadMessage,
  SlackBlock,
  ActionBlock,
  ActionBlockType,
  ISlackService,
} from './types';

export type {
  SlackMessage,
  SlackThreadMessage,
  SlackBlock,
  ActionBlock,
  ActionBlockType,
  ISlackService,
};

export class SlackService implements ISlackService {
  constructor(
    private readonly botToken: string,
    private readonly signingSecret: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /**
   * Verify the HMAC-SHA256 signature on an inbound Slack request.
   *
   * Rejects requests older than 5 minutes to prevent replay attacks.
   * Uses a timing-safe comparison to prevent timing attacks.
   *
   * @param signature - Value of the `X-Slack-Signature` header
   * @param timestamp - Value of the `X-Slack-Request-Timestamp` header
   * @param body - Raw request body string
   * @returns `true` if the signature is valid, `false` otherwise
   * @see https://api.slack.com/authentication/verifying-requests-from-slack
   */
  verifySignature(signature: string, timestamp: string, body: string): boolean {
    if (!this.signingSecret) {
      console.warn('[Slack] No signing secret configured');

      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - parseInt(timestamp)) > SLACK_TIMESTAMP_TOLERANCE_SECONDS) {
      console.warn('[Slack] Request timestamp too old');

      return false;
    }

    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', this.signingSecret).update(baseString).digest('hex');
    const computed = `v0=${hmac}`;

    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
    } catch {
      return false;
    }
  }

  /**
   * Post a message to a Slack channel or thread.
   *
   * @param channel - Channel ID or name
   * @param text - Fallback plain text (shown in notifications)
   * @param blocks - Optional Block Kit blocks for rich formatting
   * @param threadTs - When provided, posts as a thread reply
   * @returns Message timestamp and channel, or `null` on failure
   */
  async postMessage(
    channel: string,
    text: string,
    blocks?: SlackBlock[],
    threadTs?: string
  ): Promise<SlackMessage | null> {
    if (!this.botToken) {
      console.warn('[Slack] No bot token configured');

      return null;
    }

    try {
      const response = await this.fetchFn(SLACK_ENDPOINTS.postMessage, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          channel,
          text,
          ...(blocks && { blocks }),
          ...(threadTs && { thread_ts: threadTs }),
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        ts?: string;
        channel?: string;
        error?: string;
      };

      if (!data.ok) {
        console.error('[Slack] Post message error:', data.error);

        return null;
      }

      return { ts: data.ts!, channel: data.channel! };
    } catch (error) {
      console.error('[Slack] Post message exception:', error);

      return null;
    }
  }

  /**
   * Update an existing Slack message in-place.
   *
   * @param channel - Channel ID containing the message
   * @param ts - Timestamp of the message to update
   * @param text - New plain text content
   * @param blocks - Optional new Block Kit blocks
   * @returns `true` on success, `false` on failure
   */
  async updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<boolean> {
    if (!this.botToken) {
      console.warn('[Slack] No bot token configured');

      return false;
    }

    try {
      const response = await this.fetchFn(SLACK_ENDPOINTS.updateMessage, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({ channel, ts, text, ...(blocks && { blocks }) }),
      });

      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!data.ok) {
        console.error('[Slack] Update message error:', data.error);

        return false;
      }

      return true;
    } catch (error) {
      console.error('[Slack] Update message exception:', error);

      return false;
    }
  }

  /**
   * Fetch thread replies for conversation memory.
   *
   * Returns messages in chronological order with role inference
   * (bot messages → `'assistant'`, human messages → `'user'`).
   * The current triggering message is excluded from the result.
   *
   * @param channel - Channel ID containing the thread
   * @param threadTs - Timestamp of the root thread message
   * @param limit - Maximum number of messages to fetch (default: `20`)
   */
  async getThreadMessages(
    channel: string,
    threadTs: string,
    limit = 20
  ): Promise<SlackThreadMessage[]> {
    if (!this.botToken) return [];

    try {
      const repliesRes = await this.fetchFn(
        `${SLACK_ENDPOINTS.conversationsReplies}?channel=${channel}&ts=${threadTs}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${this.botToken}` } }
      );
      const repliesData = (await repliesRes.json()) as {
        ok: boolean;
        messages?: Array<{ ts: string; text?: string; bot_id?: string; user?: string }>;
      };

      if (!repliesData.ok || !repliesData.messages) return [];

      const authRes = await this.fetchFn(SLACK_ENDPOINTS.authTest, {
        headers: { Authorization: `Bearer ${this.botToken}` },
      });
      const authData = (await authRes.json()) as { ok: boolean; user_id?: string };
      const botUserId = authData.ok ? authData.user_id : null;

      const messages: SlackThreadMessage[] = [];

      for (const msg of repliesData.messages) {
        if (msg.ts === threadTs && repliesData.messages.length > 1) continue;

        const isBot = msg.bot_id || (botUserId && msg.user === botUserId);
        const text = (msg.text || '').replace(/<@.+?>/g, '').trim();

        if (!text) continue;

        messages.push({ role: isBot ? 'assistant' : 'user', text });
      }

      // Drop the last user message — it's the current question, handled separately
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        messages.pop();
      }

      return messages;
    } catch (error) {
      console.error('[Slack] Failed to fetch thread messages:', error);

      return [];
    }
  }

  /**
   * Convert markdown text to Slack mrkdwn format.
   *
   * @param text - Markdown-formatted string
   * @returns Slack mrkdwn-formatted string
   */
  static formatForSlack(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/___/g, '_')
      .replace(/^#+\s+(.+?)$/gm, '*$1*')
      .replace(/```([\s\S]+?)```/g, '```$1```')
      .replace(/^- /gm, '• ');
  }

  /**
   * Parse `:::action{...}:::` blocks embedded in AI response text.
   *
   * @param text - AI response text that may contain action blocks
   * @returns Parsed action blocks (malformed blocks are skipped)
   */
  static parseActions(text: string): ActionBlock[] {
    const actions: ActionBlock[] = [];
    const actionRegex = /:::action(\{.+?\}):::/g;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      try {
        actions.push(JSON.parse(match[1]) as ActionBlock);
      } catch {
        console.error('[Slack] Failed to parse action:', match[1]);
      }
    }

    return actions;
  }

  /**
   * Remove `:::action{...}:::` blocks from text.
   * Used when rendering action blocks as buttons instead of inline text.
   *
   * @param text - Text containing action blocks
   * @returns Text with all action blocks removed
   */
  static stripActions(text: string): string {
    return text.replace(/:::action\{.+?\}:::/g, '').trim();
  }

  /**
   * Build Slack Block Kit blocks for a message with optional action buttons.
   *
   * Text is split into chunks to respect Slack's 3000-char block limit.
   * Action buttons are grouped into rows of at most 5 (Slack's limit per row).
   *
   * @param text - Main message text (markdown)
   * @param actions - Action blocks to render as buttons
   * @param channelId - Channel ID to embed in button values (for interactions handler)
   * @param threadTs - Thread timestamp to embed in button values
   */
  static buildBlocks(
    text: string,
    actions: ActionBlock[],
    channelId?: string,
    threadTs?: string
  ): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    if (text.trim()) {
      const formatted = SlackService.formatForSlack(text);
      const chunks = SlackService.splitText(formatted, SLACK_BLOCK_MAX_CHARS);

      for (const chunk of chunks) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
      }
    }

    if (actions.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '*Recommended Actions:*' },
      });

      for (let i = 0; i < actions.length; i += SLACK_MAX_BUTTONS_PER_ROW) {
        const row = actions.slice(i, i + SLACK_MAX_BUTTONS_PER_ROW);

        blocks.push({
          type: 'actions',
          elements: row.map((action) => ({
            type: 'button',
            text: { type: 'plain_text', text: SlackService.getActionLabel(action), emoji: true },
            value: JSON.stringify({
              action_type: action.type,
              action_id: action.id,
              action_name: action.name,
              action_budget: action.budget,
              channel_id: channelId,
              thread_ts: threadTs,
            }),
            action_id: `${action.type}_${action.id}`,
            style: SlackService.getActionStyle(action.type),
          })),
        });
      }

      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: "_Click a button to execute the action. You'll be asked to confirm._",
          },
        ],
      });
    }

    return blocks;
  }

  private static splitText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLen) {
      let breakAt = remaining.lastIndexOf('\n\n', maxLen);

      if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf('\n', maxLen);
      if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(' ', maxLen);
      if (breakAt < maxLen * 0.3) breakAt = maxLen;

      chunks.push(remaining.slice(0, breakAt).trim());
      remaining = remaining.slice(breakAt).trim();
    }

    if (remaining) chunks.push(remaining);

    return chunks;
  }

  private static getActionLabel(action: ActionBlock): string {
    const name =
      action.name.length > ACTION_LABEL_MAX_CHARS
        ? action.name.slice(0, ACTION_LABEL_MAX_CHARS - 3) + '...'
        : action.name;

    switch (action.type) {
      case 'pause_campaign':
      case 'pause_ad_set':
      case 'pause_ad':
        return `⏸ Pause "${name}"`;
      case 'resume_campaign':
      case 'resume_ad_set':
      case 'resume_ad':
        return `▶ Resume "${name}"`;
      case 'adjust_budget':
        return `💰 "${name}" → $${action.budget?.toFixed(2)}/day`;
      default:
        return 'Execute';
    }
  }

  private static getActionStyle(type: ActionBlockType): string {
    return type.startsWith('pause') ? 'danger' : 'primary';
  }
}
