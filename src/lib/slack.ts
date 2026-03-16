import crypto from 'crypto';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

/**
 * Verify Slack request signature
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const signingSecret = SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.warn('[Slack] No SLACK_SIGNING_SECRET configured');
    return false;
  }

  // Verify timestamp is not too old (more than 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    console.warn('[Slack] Request timestamp too old');
    return false;
  }

  // Create base string
  const baseString = `v0:${timestamp}:${body}`;

  // Calculate HMAC
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');

  const computedSignature = `v0=${hmac}`;

  // Compare signatures (timing-safe comparison)
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

/**
 * Post a message to Slack
 */
export async function postSlackMessage(
  channel: string,
  text: string,
  blocks?: any[],
  threadTs?: string
): Promise<{ ts: string; channel: string } | null> {
  if (!SLACK_BOT_TOKEN) {
    console.warn('[Slack] No SLACK_BOT_TOKEN configured');
    return null;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        text,
        ...(blocks && { blocks }),
        ...(threadTs && { thread_ts: threadTs }),
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('[Slack] Post message error:', data.error);
      return null;
    }

    return { ts: data.ts, channel: data.channel };
  } catch (error) {
    console.error('[Slack] Post message exception:', error);
    return null;
  }
}

/**
 * Update an existing Slack message
 */
export async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string,
  blocks?: any[]
): Promise<boolean> {
  if (!SLACK_BOT_TOKEN) {
    console.warn('[Slack] No SLACK_BOT_TOKEN configured');
    return false;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        ts,
        text,
        ...(blocks && { blocks }),
      }),
    });

    const data = await response.json();

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
 * Returns messages in chronological order (oldest first).
 * Each message includes the user/bot_id and text.
 */
export async function getThreadMessages(
  channel: string,
  threadTs: string,
  limit: number = 20
): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
  if (!SLACK_BOT_TOKEN) return [];

  try {
    const response = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );

    const data = await response.json();
    if (!data.ok || !data.messages) return [];

    // Get bot user ID so we can identify our own messages
    const authRes = await fetch('https://slack.com/api/auth.test', {
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const authData = await authRes.json();
    const botUserId = authData.ok ? authData.user_id : null;

    const messages: Array<{ role: 'user' | 'assistant'; text: string }> = [];

    // Skip the first message (it's the original thread parent) if it's just the @mention
    // Include all replies in the thread
    for (const msg of data.messages) {
      // Skip the very last message (the current @mention that triggered this call)
      if (msg.ts === threadTs && data.messages.length > 1) continue;

      const isBot = msg.bot_id || (botUserId && msg.user === botUserId);
      const text = (msg.text || '').replace(/<@.+?>/g, '').trim();
      if (!text) continue;

      messages.push({
        role: isBot ? 'assistant' : 'user',
        text,
      });
    }

    // Remove the last user message (it's the current question, handled separately)
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
 * Convert AI analysis text to Slack mrkdwn format
 * Handles basic markdown conversion
 */
export function formatForSlack(text: string): string {
  // Convert markdown to Slack mrkdwn
  let mrkdwn = text
    // Bold: **text** -> *text*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    // Italic: _text_ stays _text_
    .replace(/___/g, '_')
    // Headers: ### text -> *text* (Slack doesn't have headers in mrkdwn)
    .replace(/^#+\s+(.+?)$/gm, '*$1*')
    // Code blocks: ```code``` -> `code` (single backticks for inline)
    .replace(/```([\s\S]+?)```/g, '```$1```')
    // Lists are already supported in Slack mrkdwn
    .replace(/^- /gm, '• ');

  return mrkdwn;
}

interface ActionBlock {
  type: 'pause_campaign' | 'resume_campaign' | 'pause_ad_set' | 'resume_ad_set' | 'pause_ad' | 'resume_ad' | 'adjust_budget';
  id: string;
  name: string;
  budget?: number;
}

/**
 * Parse action blocks from AI response
 * Format: :::action{"type":"pause_campaign","id":"123","name":"Campaign Name"}:::
 */
export function parseActions(text: string): ActionBlock[] {
  const actions: ActionBlock[] = [];
  const actionRegex = /:::action(\{.+?\}):::/g;

  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const action = JSON.parse(match[1]) as ActionBlock;
      actions.push(action);
    } catch (e) {
      console.error('[Slack] Failed to parse action:', match[1], e);
    }
  }

  return actions;
}

/**
 * Remove action blocks from text (they'll be rendered as buttons instead)
 */
export function stripActions(text: string): string {
  return text.replace(/:::action\{.+?\}:::/g, '').trim();
}

/**
 * Build Slack Block Kit blocks for a message with actions
 */
export function buildSlackBlocks(
  text: string,
  actions: ActionBlock[],
  channelId?: string,
  threadTs?: string
): any[] {
  const blocks: any[] = [];

  // Main text section — split into chunks if > 2900 chars (Slack limit is 3000)
  if (text.trim()) {
    const formatted = formatForSlack(text);
    const chunks = splitText(formatted, 2900);
    for (const chunk of chunks) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: chunk,
        },
      });
    }
  }

  // Action buttons (if any)
  if (actions.length > 0) {
    blocks.push({
      type: 'divider',
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Recommended Actions:*',
      },
    });

    // Group actions into rows (max 5 per row)
    for (let i = 0; i < actions.length; i += 5) {
      const row = actions.slice(i, i + 5);
      const elements = row.map((action) => {
        const label = getActionLabel(action);
        const actionId = `${action.type}_${action.id}`;

        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: label,
            emoji: true,
          },
          value: JSON.stringify({
            action_type: action.type,
            action_id: action.id,
            action_name: action.name,
            action_budget: action.budget,
            channel_id: channelId,
            thread_ts: threadTs,
          }),
          action_id: actionId,
          style: getActionStyle(action.type),
        };
      });

      blocks.push({
        type: 'actions',
        elements,
      });
    }

    // Add instructions
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_Click a button to execute the action. You\'ll be asked to confirm._',
        },
      ],
    });
  }

  return blocks;
}

/**
 * Split text into chunks at paragraph boundaries, respecting max length
 */
function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Find a good break point (double newline, single newline, or space)
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

function getActionLabel(action: ActionBlock): string {
  // Slack button text max 75 chars
  const name = action.name.length > 30 ? action.name.slice(0, 27) + '...' : action.name;
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

function getActionStyle(actionType: string): string {
  if (actionType.startsWith('pause')) {
    return 'danger';
  }
  if (actionType === 'adjust_budget') {
    return 'primary';
  }
  return 'primary';
}
