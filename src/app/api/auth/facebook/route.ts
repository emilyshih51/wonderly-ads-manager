import { NextResponse } from 'next/server';
import { META_OAUTH_URL } from '@/services/meta';

/**
 * GET /api/auth/facebook
 *
 * Initiates the Facebook OAuth flow by redirecting the user to the
 * Facebook authorization dialog. Requests ads_management, ads_read,
 * business_management, and pages_read_engagement scopes.
 */
export async function GET() {
  const appId = process.env.META_APP_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/facebook/callback`;
  const scope = 'ads_management,ads_read,business_management,pages_read_engagement';
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope,
    response_type: 'code',
  });

  return NextResponse.redirect(`${META_OAUTH_URL}?${params.toString()}`);
}
