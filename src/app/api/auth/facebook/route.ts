import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { META_OAUTH_URL } from '@/services/meta';

/**
 * GET /api/auth/facebook
 *
 * Initiates the Facebook OAuth flow by redirecting the user to the
 * Facebook authorization dialog with a CSRF state parameter.
 */
export async function GET() {
  const appId = process.env.META_APP_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/facebook/callback`;
  const scope = 'email,ads_management,ads_read,business_management,pages_read_engagement';
  const state = crypto.randomUUID();

  const cookieStore = await cookies();

  cookieStore.set('wonderly_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope,
    response_type: 'code',
    state,
  });

  return NextResponse.redirect(`${META_OAUTH_URL}?${params.toString()}`);
}
