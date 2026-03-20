import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`);
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=no_code`);
  }

  try {
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/slack/callback`,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Slack OAuth error:', data.error);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=slack_auth_failed`
      );
    }

    // Store Slack connection in a cookie (in production, use a database)
    const slackConnection = {
      team_id: data.team?.id,
      team_name: data.team?.name,
      channel_id: data.incoming_webhook?.channel_id,
      channel_name: data.incoming_webhook?.channel,
      webhook_url: data.incoming_webhook?.url,
      access_token: data.access_token,
      bot_user_id: data.bot_user_id,
    };

    // Store as cookie for now
    const cookieResponse = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?slack=connected`
    );
    cookieResponse.cookies.set('wonderly_slack', JSON.stringify(slackConnection), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

    return cookieResponse;
  } catch (error) {
    console.error('Slack callback error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=slack_callback_failed`
    );
  }
}
