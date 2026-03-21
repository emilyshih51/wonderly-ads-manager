import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { createSlackService } from '@/services/slack';
import { metaErrorResponse } from '@/lib/meta-error-response';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Notify');

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL || '';

/**
 * POST /api/meta/notify
 *
 * Sends a Slack notification for Meta ad events. Currently supports:
 * - `type: "launch"` — Posts an ad set launch message with budget and ad count.
 *   Optional `custom_message` supports `{adset_name}`, `{budget}`, `{ad_count}`,
 *   `{status}` placeholders.
 */
export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;

  logger.info('POST /api/meta/notify');

  try {
    const body = await request.json();
    const { type } = body;

    if (type === 'launch') {
      const { adset_name, budget, ad_count, status, custom_message } = body;
      const channel = body.slack_channel || SLACK_CHANNEL;

      if (!channel) {
        return NextResponse.json({
          success: true,
          slack_sent: false,
          reason: 'No Slack channel configured',
        });
      }

      const budgetDisplay = budget ? `$${parseFloat(budget).toFixed(2)}/day` : 'no budget set';
      const statusLabel = status === 'ACTIVE' ? 'Active' : 'Paused (draft)';

      const slack = createSlackService();

      await slack.sendLaunchNotification(channel, {
        adsetName: adset_name || '',
        budget: budgetDisplay,
        adCount: ad_count || 0,
        status: statusLabel,
        customMessage: custom_message,
      });

      return NextResponse.json({ success: true, slack_sent: true });
    }

    return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
  } catch (error: unknown) {
    logger.error('Notification error', error);

    return metaErrorResponse(error, 'Failed to send notification');
  }
}
