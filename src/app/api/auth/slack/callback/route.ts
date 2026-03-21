import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { SlackService } from '@/services/slack';
import { createLogger } from '@/services/logger';

const logger = createLogger('Auth:Slack');

/**
 * GET /api/auth/slack/callback
 *
 * Slack OAuth callback. Exchanges the authorization code for a bot
 * access token and stores the Slack connection (team, channel, webhook URL)
 * in the wonderly_slack cookie before redirecting to /settings?slack=connected.
 * Requires an active Wonderly session.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!session) {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  logger.info('Slack OAuth callback');

  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${appUrl}/settings?error=no_code`);
  }

  try {
    const data = await SlackService.exchangeCodeForToken(
      process.env.SLACK_CLIENT_ID!,
      process.env.SLACK_CLIENT_SECRET!,
      code,
      `${appUrl}/api/auth/slack/callback`
    );

    if (!data.ok) {
      logger.error('Slack OAuth error', data.error);

      return NextResponse.redirect(`${appUrl}/settings?error=slack_auth_failed`);
    }

    const slackConnection = {
      team_id: data.team?.id,
      team_name: data.team?.name,
      channel_id: data.incoming_webhook?.channel_id,
      channel_name: data.incoming_webhook?.channel,
      webhook_url: data.incoming_webhook?.url,
      access_token: data.access_token,
      bot_user_id: data.bot_user_id,
    };

    const cookieResponse = NextResponse.redirect(`${appUrl}/settings?slack=connected`);

    cookieResponse.cookies.set('wonderly_slack', JSON.stringify(slackConnection), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

    return cookieResponse;
  } catch (error) {
    logger.error('Slack callback error', error);

    return NextResponse.redirect(`${appUrl}/settings?error=slack_callback_failed`);
  }
}
