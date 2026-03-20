import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';
import { SlackService } from '@/services/slack';
import { createLogger } from '@/services/logger';

const logger = createLogger('Slack:Notify');

/**
 * POST /api/slack/notify
 *
 * Sends a Slack message using the OAuth connection stored in the
 * wonderly_slack cookie. Uses the Slack Web API via SlackService.
 * Body: `{ message, channel? }`.
 */
export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;

  try {
    const cookieStore = await cookies();
    const slackCookie = cookieStore.get('wonderly_slack');

    if (!slackCookie) {
      return NextResponse.json({ error: 'Slack not connected' }, { status: 400 });
    }

    const slackConnection = JSON.parse(slackCookie.value) as {
      access_token?: string;
      webhook_url?: string;
      channel_id?: string;
    };
    const body = await request.json();
    const { message, channel } = body;

    const targetChannel = channel || slackConnection.channel_id;

    // Prefer bot token delivery via the Slack Web API; fall back to webhook if
    // the connection was established with incoming-webhook scope only.
    if (slackConnection.access_token) {
      const slack = new SlackService(
        slackConnection.access_token,
        process.env.SLACK_SIGNING_SECRET ?? ''
      );

      if (!targetChannel) {
        return NextResponse.json({ error: 'No channel configured' }, { status: 400 });
      }

      const result = await slack.postMessage(targetChannel, message);

      if (!result) {
        throw new Error('Failed to send Slack message');
      }
    } else if (slackConnection.webhook_url) {
      const slack = new SlackService('', process.env.SLACK_SIGNING_SECRET ?? '');

      await slack.sendWebhookMessage(slackConnection.webhook_url, message);
    } else {
      return NextResponse.json(
        { error: 'No Slack access token or webhook URL configured' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Slack notify error', error);

    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
