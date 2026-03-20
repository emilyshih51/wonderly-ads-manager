import { NextRequest, NextResponse, after } from 'next/server';
import { type SlackService, createSlackService } from '@/services/slack';
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

  const slack = createSlackService();
  const slackSignature = request.headers.get('x-slack-signature') ?? '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  if (!slack.verifySignature(slackSignature, slackTimestamp, rawBody)) {
    logger.warn('Invalid signature');

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Acknowledge immediately — Slack requires a response within 3 seconds.
  // Use after() to ensure the serverless function stays alive until processing completes.
  after(async () => {
    try {
      await processInteraction(payload, slack);
    } catch (error) {
      logger.error('Background processing error', error);
    }
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

  let actionValue: ActionValue;

  try {
    actionValue = JSON.parse(actions[0].value || '{}') as ActionValue;
  } catch {
    logger.warn('Malformed action value', actions[0].value);

    return;
  }

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
    const { action_type: actionType, action_id: objectId, action_name: objectName } = actionValue;
    const label = objectName || objectId;

    const mappedType = actionType.startsWith('pause')
      ? 'pause'
      : actionType.startsWith('resume')
        ? 'resume'
        : actionType === 'adjust_budget'
          ? 'update_budget'
          : null;

    if (!mappedType) throw new Error(`Unknown action type: ${actionType}`);

    let dailyBudgetCents: number | undefined;

    if (mappedType === 'update_budget') {
      const budget = actionValue.action_budget;

      if (!budget || budget <= 0) throw new Error('Invalid budget amount');
      dailyBudgetCents = Math.round(budget) * 100;
    }

    await meta.executeAction(mappedType, objectId, dailyBudgetCents);

    const result =
      mappedType === 'pause'
        ? `✅ Paused "${label}"`
        : mappedType === 'resume'
          ? `✅ Resumed "${label}"`
          : `✅ Set daily budget of "${label}" to $${Math.round(actionValue.action_budget!).toFixed(2)}`;

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
