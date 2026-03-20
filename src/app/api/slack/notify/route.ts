import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/services/logger';

const logger = createLogger('Slack:Notify');

/**
 * POST /api/slack/notify
 *
 * Sends a Slack message using the OAuth connection stored in the
 * wonderly_slack cookie. Uses the incoming webhook URL when available,
 * otherwise falls back to the Slack Web API. Body: `{ message, channel? }`.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const slackCookie = cookieStore.get('wonderly_slack');

    if (!slackCookie) {
      return NextResponse.json({ error: 'Slack not connected' }, { status: 400 });
    }

    const slackConnection = JSON.parse(slackCookie.value);
    const body = await request.json();
    const { message, channel } = body;

    // Use webhook or API
    if (slackConnection.webhook_url) {
      const response = await fetch(slackConnection.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });

      if (!response.ok) {
        throw new Error('Webhook delivery failed');
      }
    } else {
      // Use Slack API
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${slackConnection.access_token}`,
        },
        body: JSON.stringify({
          channel: channel || slackConnection.channel_id,
          text: message,
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.error || 'Slack API error');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Slack notify error', error);

    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
