import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

/**
 * GET /api/auth/slack/status
 *
 * Returns whether a Slack OAuth connection is stored in the session cookie.
 * Response: `{ connected: boolean, info?: { team_name, channel_name } }`
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
  } catch {
    return NextResponse.json({ connected: false });
  }
}
