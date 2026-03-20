import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { SlackService } from '@/services/slack';

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL || '';

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

      let text: string;

      if (custom_message) {
        text = custom_message
          .replace(/\{adset_name\}/g, adset_name || '')
          .replace(/\{budget\}/g, budgetDisplay)
          .replace(/\{ad_count\}/g, String(ad_count || 0))
          .replace(/\{status\}/g, statusLabel);
      } else {
        text =
          `🚀 *[Wonderly]* ${adset_name} launched with ${budgetDisplay}\n` +
          `${ad_count} ad${ad_count !== 1 ? 's' : ''} created as ${statusLabel}`;
      }

      const slack = new SlackService(
        process.env.SLACK_BOT_TOKEN || '',
        process.env.SLACK_SIGNING_SECRET || ''
      );

      await slack.postMessage(channel, text);

      return NextResponse.json({ success: true, slack_sent: true });
    }

    return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Notification failed';

    console.error('[Notify] Error:', error);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
