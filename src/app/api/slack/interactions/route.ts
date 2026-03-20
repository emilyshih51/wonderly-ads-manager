import { NextRequest, NextResponse } from 'next/server';
import { SlackService } from '@/services/slack';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Slack:Interactions');

async function getRawBody(request: NextRequest): Promise<string> {
  const arrayBuffer = await request.arrayBuffer();

  return Buffer.from(arrayBuffer).toString('utf-8');
}

/**
 * POST /api/slack/interactions
 *
 * Handles Slack Block Kit button interactions (block_actions).
 * Verifies the Slack request signature, acknowledges immediately with 200,
 * then processes the action in the background. Supported actions:
 * pause/resume campaign/ad set/ad, and adjust_budget.
 * Access is gated by ALLOWED_SLACK_USER_IDS if configured.
 */
export async function POST(request: NextRequest) {
  const rawBody = await getRawBody(request);

  const params = new URLSearchParams(rawBody);
  const payloadString = params.get('payload');

  if (!payloadString) {
    return NextResponse.json({ error: 'No payload' }, { status: 400 });
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(payloadString);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const slack = new SlackService(
    process.env.SLACK_BOT_TOKEN || '',
    process.env.SLACK_SIGNING_SECRET || ''
  );
  const slackSignature = request.headers.get('x-slack-signature') || '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') || '';
  const isValid = slack.verifySignature(slackSignature, slackTimestamp, rawBody);

  if (!isValid) {
    logger.warn('Invalid signature');

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ackResponse = NextResponse.json({ ok: true });

  processInteraction(payload, slack).catch((error) => {
    logger.error('Background processing error', error);
  });

  return ackResponse;
}

async function processInteraction(payload: Record<string, unknown>, slack: SlackService) {
  const { type, actions, channel } = payload as {
    type: string;
    actions?: Array<{ value: string }>;
    channel?: { id: string };
    user?: { id: string };
    message?: { ts: string };
  };

  if (type !== 'block_actions' || !actions || actions.length === 0) {
    logger.warn('Unexpected interaction type');

    return;
  }

  const action = actions[0];
  const actionValue = JSON.parse(action.value || '{}') as {
    action_type: string;
    action_id: string;
    action_name: string;
    action_budget?: number;
    channel_id?: string;
    thread_ts?: string;
  };

  logger.info('Processing action', {
    type: actionValue.action_type,
    id: actionValue.action_id,
    name: actionValue.action_name,
  });

  const allowedSlackUsers = (process.env.ALLOWED_SLACK_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const requestingUserId = (payload.user as { id?: string })?.id;

  if (allowedSlackUsers.length > 0 && !allowedSlackUsers.includes(requestingUserId || '')) {
    const channelId = actionValue.channel_id || channel?.id;
    const threadTs = actionValue.thread_ts;

    if (channelId) {
      await slack.postMessage(
        channelId,
        "You don't have permission to execute actions.",
        undefined,
        threadTs
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
        const budgetCents = (wholeBudget * 100).toString();

        await meta.request(`/${objectId}`, { method: 'POST', body: { daily_budget: budgetCents } });
        result = `✅ Set daily budget of "${objectName || objectId}" to $${wholeBudget.toFixed(2)}`;
        break;
      }

      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }

    const channelId = actionValue.channel_id || channel?.id;

    if (channelId) {
      const messageTs = (payload.message as { ts?: string })?.ts;

      if (messageTs) {
        const blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: result } },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `_Executed at ${new Date().toLocaleTimeString()}_` },
            ],
          },
        ];

        await slack.updateMessage(channelId, messageTs, result, blocks);
      }
    }

    logger.info('Action completed', result);
  } catch (error) {
    logger.error('Error executing action', error);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const channelId = actionValue.channel_id || (payload.channel as { id?: string })?.id;
    const messageTs = (payload.message as { ts?: string })?.ts;

    if (channelId && messageTs) {
      await slack.updateMessage(channelId, messageTs, `❌ Action failed: ${errorMsg}`);
    }
  }
}
