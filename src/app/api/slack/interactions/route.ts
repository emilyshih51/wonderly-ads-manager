import { NextRequest, NextResponse } from 'next/server';
import { verifySlackSignature, updateSlackMessage } from '@/lib/slack';
import { updateStatus, metaApi } from '@/lib/meta-api';

/**
 * POST /api/slack/interactions
 *
 * Handles interactive actions (button clicks) from Slack
 * - Verify Slack request signature
 * - Parse the action from the button click
 * - Execute the action (pause, resume, adjust budget)
 * - Update the Slack message with the result
 */

// Helper to get raw request body
async function getRawBody(request: NextRequest): Promise<string> {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('utf-8');
}

export async function POST(request: NextRequest) {
  const rawBody = await getRawBody(request);

  // Parse form-encoded body (Slack sends interactions as form data)
  const params = new URLSearchParams(rawBody);
  const payloadString = params.get('payload');

  if (!payloadString) {
    return NextResponse.json({ error: 'No payload' }, { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(payloadString);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Verify signature
  const slackSignature = request.headers.get('x-slack-signature') || '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') || '';
  const isValid = verifySlackSignature(slackSignature, slackTimestamp, rawBody);

  if (!isValid) {
    console.warn('[Slack Interactions] Invalid signature');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Acknowledge immediately
  const ackResponse = NextResponse.json({ ok: true });

  // Process the action asynchronously
  processInteraction(payload).catch((error) => {
    console.error('[Slack Interactions] Background processing error:', error);
  });

  return ackResponse;
}

async function processInteraction(payload: any) {
  const { type, actions, channel, trigger_id } = payload;

  if (type !== 'block_actions' || !actions || actions.length === 0) {
    console.warn('[Slack Interactions] Unexpected interaction type');
    return;
  }

  const action = actions[0];
  const actionValue = JSON.parse(action.value || '{}');

  console.log('[Slack Interactions] Processing action:', {
    type: actionValue.action_type,
    id: actionValue.action_id,
    name: actionValue.action_name,
  });

  try {
    const metaSystemToken = process.env.META_SYSTEM_ACCESS_TOKEN;
    if (!metaSystemToken) {
      throw new Error('META_SYSTEM_ACCESS_TOKEN not configured');
    }

    let result = '';
    const actionType = actionValue.action_type;
    const objectId = actionValue.action_id;
    const objectName = actionValue.action_name;

    // Execute the action
    switch (actionType) {
      case 'pause_campaign':
      case 'pause_ad_set':
      case 'pause_ad': {
        await updateStatus(objectId, metaSystemToken, 'PAUSED');
        result = `✅ Paused "${objectName || objectId}"`;
        break;
      }

      case 'resume_campaign':
      case 'resume_ad_set':
      case 'resume_ad': {
        await updateStatus(objectId, metaSystemToken, 'ACTIVE');
        result = `✅ Resumed "${objectName || objectId}"`;
        break;
      }

      case 'adjust_budget': {
        const budget = actionValue.action_budget;
        if (!budget || budget <= 0) {
          throw new Error('Invalid budget amount');
        }
        // Round to whole dollar — never set fractional budgets
        const wholeBudget = Math.round(budget);
        const budgetCents = (wholeBudget * 100).toString();
        await metaApi(`/${objectId}`, metaSystemToken, {
          method: 'POST',
          body: { daily_budget: budgetCents },
        });
        result = `✅ Set daily budget of "${objectName || objectId}" to $${wholeBudget.toFixed(2)}`;
        break;
      }

      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }

    // Update the Slack message with the result
    const channelId = actionValue.channel_id || channel?.id;
    const threadTs = actionValue.thread_ts;

    if (channelId) {
      // Find the message timestamp from the payload
      const messageTs = payload.message?.ts;

      if (messageTs) {
        const blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: result,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `_Executed at ${new Date().toLocaleTimeString()}_`,
              },
            ],
          },
        ];

        await updateSlackMessage(channelId, messageTs, result, blocks);
      }
    }

    console.log('[Slack Interactions] Action completed:', result);
  } catch (error) {
    console.error('[Slack Interactions] Error executing action:', error);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const channelId = actionValue.channel_id || payload.channel?.id;
    const messageTs = payload.message?.ts;

    if (channelId && messageTs) {
      await updateSlackMessage(
        channelId,
        messageTs,
        `❌ Action failed: ${errorMsg}`
      );
    }
  }
}
