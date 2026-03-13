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
  blocks?: any[]
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

  // Main text section
  if (text.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: formatForSlack(text),
      },
    });
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

function getActionLabel(action: ActionBlock): string {
  switch (action.type) {
    case 'pause_campaign':
    case 'pause_ad_set':
    case 'pause_ad':
      return `⏸ Pause`;
    case 'resume_campaign':
    case 'resume_ad_set':
    case 'resume_ad':
      return `▶ Resume`;
    case 'adjust_budget':
      return `💰 Set to $${action.budget?.toFixed(2)}`;
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
