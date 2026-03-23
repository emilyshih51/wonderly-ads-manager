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
import { createLogger } from '@/services/logger';
import { formatCurrency } from '@/lib/utils';
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
  AutomationNotification,
  BudgetNotification,
  BudgetRunSummary,
  LaunchNotification,
} from './types';

const logger = createLogger('Slack');

export class SlackService {
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
      logger.warn('No signing secret configured');

      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - parseInt(timestamp)) > SLACK_TIMESTAMP_TOLERANCE_SECONDS) {
      logger.warn('Request timestamp too old');

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
      logger.warn('No bot token configured');

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
        logger.error('Post message error', data.error);

        return null;
      }

      return { ts: data.ts!, channel: data.channel! };
    } catch (error) {
      logger.error('Post message exception', error);

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
      logger.warn('No bot token configured');

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
        logger.error('Update message error', data.error);

        return false;
      }

      return true;
    } catch (error) {
      logger.error('Update message exception', error);

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
      logger.error('Failed to fetch thread messages', error);

      return [];
    }
  }

  /**
   * Post an automation rule action notification to a Slack channel.
   *
   * Builds a rich notification with entity name, metrics snapshot, and a link
   * to the Meta Ads Manager. Supports custom message templates with `{placeholder}` tokens.
   *
   * @param channelId - Slack channel ID to post to
   * @param notification - Notification payload describing the action and its context
   * @returns The posted message metadata, or `null` on failure
   */
  async sendAutomationNotification(
    channelId: string,
    notification: AutomationNotification
  ): Promise<SlackMessage | null> {
    const {
      ruleName,
      actionType,
      entityType,
      entityId,
      entityName,
      adAccountId,
      metrics,
      customMessage,
      duplicatedAdId,
      prefix = '',
    } = notification;

    const adManagerLink = SlackService.buildAdManagerLink(adAccountId, entityName, entityId);

    const actionEmoji = actionType === 'promote' ? '🚀' : actionType === 'activate' ? '▶️' : '⏸️';
    const actionVerb =
      actionType === 'promote' ? 'Promoted' : actionType === 'activate' ? 'Activated' : 'Paused';

    const resultDisplay = metrics.results ?? 0;
    const cpaDisplay =
      metrics.cost_per_result === 99999 || !isFinite(metrics.cost_per_result)
        ? 'N/A'
        : `$${metrics.cost_per_result.toFixed(2)}`;

    let fallbackText: string;
    const bodySections: string[] = [];

    if (customMessage) {
      fallbackText =
        prefix +
        SlackService.sanitizeMentions(customMessage)
          .replace(/\{rule_name\}/g, SlackService.sanitizeMentions(ruleName))
          .replace(/\{action\}/g, actionVerb)
          .replace(/\{entity_type\}/g, entityType)
          .replace(/\{entity_name\}/g, SlackService.sanitizeMentions(entityName))
          .replace(/\{ad_link\}/g, `<${adManagerLink}|${entityName}>`)
          .replace(/\{spend\}/g, `$${metrics.spend.toFixed(2)}`)
          .replace(/\{results\}/g, String(resultDisplay))
          .replace(/\{cpa\}/g, cpaDisplay)
          .replace(/\{clicks\}/g, String(metrics.clicks ?? 0))
          .replace(/\{ctr\}/g, `${((metrics.ctr ?? 0) * 100).toFixed(2)}%`);

      bodySections.push(fallbackText);
    } else {
      fallbackText = `${prefix}[Wonderly] ${actionEmoji} ${ruleName} — ${actionVerb} ${entityType}: ${entityName}`;
      bodySections.push(`${actionVerb} ${entityType}: <${adManagerLink}|${entityName}>`);
      bodySections.push(
        `*Spend:* $${metrics.spend.toFixed(2)}  *Results:* ${resultDisplay}  *CPA:* ${cpaDisplay}`
      );
    }

    if (duplicatedAdId) {
      const dupLink = SlackService.buildAdManagerLink(
        adAccountId,
        `${entityName} [Winner Copy]`,
        duplicatedAdId
      );

      bodySections.push(`Duplicated to winners ad set: <${dupLink}|View new ad>`);
    }

    const header = `${prefix}${actionEmoji} *[Wonderly]* ${ruleName}`;
    const blocks = SlackService.buildNotificationBlocks(
      header,
      bodySections,
      SlackService.timestampFooter()
    );

    return this.postMessage(channelId, fallbackText, blocks);
  }

  /**
   * Post a budget change notification to a Slack channel.
   *
   * @param channelId - Slack channel ID to post to
   * @param notification - Budget notification payload
   * @returns The posted message metadata, or `null` on failure
   */
  async sendBudgetNotification(
    channelId: string,
    notification: BudgetNotification
  ): Promise<SlackMessage | null> {
    const { entityName, newBudget, previousBudget } = notification;
    const newDisplay = `$${newBudget.toFixed(2)}`;

    let bodyText: string;
    let fallbackText: string;

    if (previousBudget !== undefined) {
      const prevDisplay = `$${previousBudget.toFixed(2)}`;
      const direction = newBudget > previousBudget ? 'raised' : 'lowered';

      bodyText = `*${entityName}* ${direction} budget from ${prevDisplay} to ${newDisplay}/day`;
      fallbackText = `[Wonderly] ${entityName} ${direction} budget from ${prevDisplay} to ${newDisplay}/day`;
    } else {
      bodyText = `*${entityName}* budget changed to ${newDisplay}/day`;
      fallbackText = `[Wonderly] ${entityName} budget changed to ${newDisplay}/day`;
    }

    const header = `*[Wonderly]* Budget Change`;
    const blocks = SlackService.buildNotificationBlocks(
      header,
      [bodyText],
      SlackService.timestampFooter()
    );

    return this.postMessage(channelId, fallbackText, blocks);
  }

  /**
   * Post a grouped budget change summary after a cron run.
   *
   * Sends a single message listing all entities whose budgets were adjusted
   * in one direction during the run, formatted as:
   * ```
   * [1:58 AM][Wonderly] Increasing spend
   * Entity A to $750
   * Entity B to $800
   * ```
   *
   * @param channelId - Slack channel ID to post to
   * @param summary - Budget run summary with direction and list of changes
   * @returns The posted message metadata, or `null` on failure
   */
  async sendBudgetRunSummary(
    channelId: string,
    summary: BudgetRunSummary
  ): Promise<SlackMessage | null> {
    const { direction, changes, runTime = new Date() } = summary;

    const hours = runTime.getUTCHours();
    const minutes = runTime.getUTCMinutes().toString().padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    const timeStr = `${displayHour}:${minutes} ${period}`;

    const verb = direction === 'increase' ? 'Increasing' : 'Decreasing';
    const header = `*[${timeStr}][Wonderly]* ${verb} spend`;

    const changeLines = changes
      .map((c) => `${c.entityName} to ${formatCurrency(c.newBudget)}`)
      .join('\n');

    const fallbackText = `[${timeStr}][Wonderly] ${verb} spend\n${changeLines}`;

    const blocks = SlackService.buildNotificationBlocks(header, [changeLines]);

    return this.postMessage(channelId, fallbackText, blocks);
  }

  /**
   * Post an ad set launch notification to a Slack channel.
   *
   * @param channelId - Slack channel ID to post to
   * @param notification - Launch notification payload
   * @returns The posted message metadata, or `null` on failure
   */
  async sendLaunchNotification(
    channelId: string,
    notification: LaunchNotification
  ): Promise<SlackMessage | null> {
    const { adsetName, budget, adCount, status, customMessage } = notification;

    let bodyText: string;
    let fallbackText: string;

    if (customMessage) {
      bodyText = SlackService.sanitizeMentions(customMessage)
        .replace(/\{adset_name\}/g, SlackService.sanitizeMentions(adsetName))
        .replace(/\{budget\}/g, budget)
        .replace(/\{ad_count\}/g, String(adCount))
        .replace(/\{status\}/g, status);
      fallbackText = `[Wonderly] ${adsetName} launched with ${budget}`;
    } else {
      bodyText =
        `*${SlackService.sanitizeMentions(adsetName)}* launched with ${budget}\n` +
        `${adCount} ad${adCount !== 1 ? 's' : ''} created as ${status}`;
      fallbackText = `[Wonderly] ${adsetName} launched with ${budget}`;
    }

    const header = `*[Wonderly]* Ad Set Launched`;
    const blocks = SlackService.buildNotificationBlocks(
      header,
      [bodyText],
      SlackService.timestampFooter()
    );

    return this.postMessage(channelId, fallbackText, blocks);
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
        logger.error('Failed to parse action', match[1]);
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

  /**
   * Build a Slack mrkdwn timestamp footer for notification blocks.
   */
  static timestampFooter(): string {
    return `_${new Date().toLocaleTimeString()}_`;
  }

  /**
   * Build a consistent Block Kit notification layout.
   *
   * @param header - Bold header line (mrkdwn)
   * @param body - Body text sections (each becomes a section block)
   * @param footer - Optional footer text shown as a context block
   */
  static buildNotificationBlocks(header: string, body: string[], footer?: string): SlackBlock[] {
    const blocks: SlackBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text: header } }];

    for (const section of body) {
      if (section) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: section } });
      }
    }

    if (footer) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: footer }],
      });
    }

    return blocks;
  }

  /**
   * Builds a Facebook Ads Manager deep link filtered to a specific ad.
   *
   * @param adAccountId - Meta ad account ID (without `act_` prefix)
   * @param entityName - Ad name used for the search filter
   * @param entityId - Ad ID to pre-select
   */
  private static buildAdManagerLink(
    adAccountId: string,
    entityName: string,
    entityId: string
  ): string {
    const encodedName = encodeURIComponent(`"[\\\"${entityName}\\\"]"`);
    const filterSet = `SEARCH_BY_ADGROUP_NAME-STRING%1ECONTAINS_ALL%1E${encodedName}`;

    const url = new URL('https://adsmanager.facebook.com/adsmanager/manage/ads');

    url.searchParams.set('act', adAccountId);
    url.searchParams.set('filter_set', filterSet);
    url.searchParams.set('selected_ad_ids', entityId);
    url.searchParams.set('date_source', 'today');
    url.searchParams.set('nav_source', 'ads_manager');

    return url.toString();
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

  // ─── Static OAuth helpers ────────────────────────────────────────────────────

  /**
   * Exchange a Slack OAuth authorization code for a bot access token.
   *
   * @param clientId - Slack app client ID (`SLACK_CLIENT_ID`)
   * @param clientSecret - Slack app client secret (`SLACK_CLIENT_SECRET`)
   * @param code - Authorization code from the OAuth redirect
   * @param redirectUri - Must match the URI registered in the Slack app
   * @returns The full `oauth.v2.access` response
   */
  static async exchangeCodeForToken(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<{
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id: string; name: string };
    incoming_webhook?: { channel_id: string; channel: string; url: string };
  }> {
    const response = await fetch(SLACK_ENDPOINTS.oauthAccess, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    return response.json() as ReturnType<typeof SlackService.exchangeCodeForToken>;
  }

  static sanitizeMentions(text: string): string {
    return text.replace(/@(channel|here|everyone)/gi, '(@$1)');
  }

  async sendWebhookMessage(webhookUrl: string, text: string): Promise<void> {
    const response = await this.fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed (${response.status})`);
    }
  }
}

export function createSlackService(): SlackService {
  return new SlackService(
    process.env.SLACK_BOT_TOKEN ?? '',
    process.env.SLACK_SIGNING_SECRET ?? ''
  );
}
