import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';

/**
 * GET /api/auth/slack/redirect
 *
 * Initiates the Slack OAuth flow by redirecting the user to the Slack
 * authorization page. Requires an active session — unauthenticated
 * users are redirected to login.
 */
export async function GET() {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;

  const clientId = process.env.SLACK_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/slack/callback`;
  const scope = 'chat:write,channels:read,incoming-webhook';

  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return NextResponse.redirect(authUrl);
}
