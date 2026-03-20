import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Auth:Facebook');

/**
 * GET /api/auth/facebook/callback
 *
 * Facebook OAuth callback. Exchanges the authorization code for a
 * long-lived access token, fetches user info and ad accounts, checks
 * the optional ALLOWED_EMAILS allowlist, and writes the session cookie
 * before redirecting to /dashboard.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=no_code`);
  }

  try {
    const appId = process.env.META_APP_ID!;
    const appSecret = process.env.META_APP_SECRET!;
    const redirectUri = `${appUrl}/api/auth/facebook/callback`;

    const tokenData = await MetaService.exchangeCodeForToken(appId, appSecret, code, redirectUri);

    if (tokenData.error) {
      return NextResponse.redirect(`${appUrl}/login?error=token_error`);
    }

    const longLivedData = await MetaService.exchangeForLongLivedToken(
      appId,
      appSecret,
      tokenData.access_token!
    );
    const accessToken = longLivedData.access_token ?? tokenData.access_token!;

    const userData = await MetaService.getMe(accessToken);

    // Allowlist check — only let authorized users in
    const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedEmails.length > 0 && !allowedEmails.includes(userData.email ?? '')) {
      return NextResponse.redirect(`${appUrl}/login?error=unauthorized`);
    }

    const adAccountsData = await MetaService.getMyAdAccounts(accessToken);

    // Use the configured ad account or the first available
    const configuredAccountId = process.env.META_AD_ACCOUNT_ID;
    let adAccountId = configuredAccountId;

    if (!adAccountId && (adAccountsData.data?.length ?? 0) > 0) {
      adAccountId = adAccountsData.data![0].id.replace('act_', '');
    }

    const session = {
      id: userData.id,
      email: userData.email ?? '',
      name: userData.name ?? '',
      meta_access_token: accessToken,
      meta_user_id: userData.id,
      ad_account_id: adAccountId ?? '',
    };

    const cookieStore = await cookies();

    cookieStore.set('wonderly_session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });

    return NextResponse.redirect(`${appUrl}/dashboard`);
  } catch (error) {
    logger.error('Facebook auth error', error);

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=auth_failed`);
  }
}
