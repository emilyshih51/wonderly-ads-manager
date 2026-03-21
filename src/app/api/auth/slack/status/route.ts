import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';
import { createLogger } from '@/services/logger';

const logger = createLogger('Auth:SlackStatus');

/**
 * GET /api/auth/slack/status
 *
 * Returns whether a Slack OAuth connection is stored in the session cookie.
 * Response: `{ connected: boolean, info?: { team_name, channel_name } }`
 */
export async function GET() {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;

  logger.info('Checking Slack connection status');

  const cookieStore = await cookies();
  const slackCookie = cookieStore.get('wonderly_slack');

  if (!slackCookie) {
    return NextResponse.json({ connected: false });
  }

  try {
    const slack = JSON.parse(slackCookie.value);

    return NextResponse.json({
      connected: true,
      info: {
        team_name: slack.team_name,
        channel_name: slack.channel_name,
      },
    });
  } catch (e) {
    logger.warn('Malformed slack cookie', e);

    return NextResponse.json({ connected: false });
  }
}
