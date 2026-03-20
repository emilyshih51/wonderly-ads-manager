import { NextResponse } from 'next/server';

/**
 * GET /api/auth/slack/redirect
 *
 * Initiates the Slack OAuth flow by redirecting the user to the Slack
 * authorization page. Requests chat:write, channels:read, and
 * incoming-webhook scopes.
 */
export async function GET() {
  const clientId = process.env.SLACK_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/slack/callback`;
  const scope = 'chat:write,channels:read,incoming-webhook';

  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return NextResponse.redirect(authUrl);
}
