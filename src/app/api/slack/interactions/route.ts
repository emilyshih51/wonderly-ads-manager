import { NextRequest, NextResponse } from 'next/server';
import { SlackService } from '@/services/slack';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Slack:Interactions');

/**
 * POST /api/slack/interactions
 *
 * Handles Slack Block Kit button interactions (`block_actions`).
 * Verifies the Slack request signature, acknowledges immediately with 200,
 * then processes the action in the background. Supported actions:
 * pause/resume campaign/ad set/ad, and adjust_budget.
 *
 * Access is gated by `ALLOWED_SLACK_USER_IDS` (comma-separated) if configured.
 */
export async function POST(request: NextRequest) {
  const arrayBuffer = await request.arrayBuffer();
  const rawBody = Buffer.from(arrayBuffer).toString('utf-8');

  const params = new URLSearchParams(rawBody);
  const payloadString = params.get('payload');

  if (!payloadString) {
    return NextResponse.json({ error: 'No payload' }, { status: 400 });
  }

  let payload: InteractionPayload;

  try {
    payload = JSON.parse(payloadString) as InteractionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const slack = new SlackService(
    process.env.SLACK_BOT_TOKEN ?? '',
    process.env.SLACK_SIGNING_SECRET ?? ''
  );
  const slackSignature = request.headers.get('x-slack-signature') ?? '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  if (!slack.verifySignature(slackSignature, slackTimestamp, rawBody)) {
    logger.warn('Invalid signature');

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Acknowledge immediately — Slack requires a response within 3 seconds
  processInteraction(payload, slack).catch((error) => {
    logger.error('Background processing error', error);
  });

  return NextResponse.json({ ok: true });
}

interface ActionValue {
  action_type: string;
  action_id: string;
  action_name: string;
  action_budget?: number;
  channel_id?: string;
  thread_ts?: string;
}

interface InteractionPayload {
  type: string;
  actions?: Array<{ value: string }>;
  channel?: { id: string };
  user?: { id: string };
  message?: { ts: string };
}

async function processInteraction(payload: InteractionPayload, slack: SlackService): Promise<void> {
  const { type, actions, channel } = payload;

  if (type !== 'block_actions' || !actions || actions.length === 0) {
    logger.warn('Unexpected interaction type');

    return;
  }

  const actionValue = JSON.parse(actions[0].value || '{}') as ActionValue;

  logger.info('Processing action', {
    type: actionValue.action_type,
    id: actionValue.action_id,
    name: actionValue.action_name,
  });

  const allowedSlackUsers = (process.env.ALLOWED_SLACK_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const requestingUserId = payload.user?.id;

  if (allowedSlackUsers.length > 0 && !allowedSlackUsers.includes(requestingUserId ?? '')) {
    const channelId = actionValue.channel_id ?? channel?.id;

    if (channelId) {
      await slack.postMessage(
        channelId,
        "You don't have permission to execute actions.",
        undefined,
        actionValue.thread_ts
      );
    }

    return;
  }

  try {
    const metaSystemToken = process.env.META_SYSTEM_ACCESS_TOKEN;

    if (!metaSystemToken) {
      throw new Error('META_SYSTEM_ACCESS_TOKEN not configured');
    }

    const meta = new MetaService(metaSystemToken, '');
    let result = '';
    const { action_type: actionType, action_id: objectId, action_name: objectName } = actionValue;

    switch (actionType) {
      case 'pause_campaign':
      case 'pause_ad_set':

      case 'pause_ad': {
        await meta.updateStatus(objectId, 'PAUSED');
        result = `✅ Paused "${objectName || objectId}"`;
        break;
      }

      case 'resume_campaign':
      case 'resume_ad_set':

      case 'resume_ad': {
        await meta.updateStatus(objectId, 'ACTIVE');
        result = `✅ Resumed "${objectName || objectId}"`;
        break;
      }

      case 'adjust_budget': {
        const budget = actionValue.action_budget;

        if (!budget || budget <= 0) throw new Error('Invalid budget amount');

        const wholeBudget = Math.round(budget);

        await meta.updateBudget(objectId, wholeBudget * 100);
        result = `✅ Set daily budget of "${objectName || objectId}" to $${wholeBudget.toFixed(2)}`;
        break;
      }

      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }

    const channelId = actionValue.channel_id ?? channel?.id;

    if (channelId && payload.message?.ts) {
      const blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: result } },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `_Executed at ${new Date().toLocaleTimeString()}_` }],
        },
      ];

      await slack.updateMessage(channelId, payload.message.ts, result, blocks);
    }

    logger.info('Action completed', result);
  } catch (error) {
    logger.error('Error executing action', error);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const channelId = actionValue.channel_id ?? channel?.id;

    if (channelId && payload.message?.ts) {
      await slack.updateMessage(channelId, payload.message.ts, `❌ Action failed: ${errorMsg}`);
    }
  }
}
