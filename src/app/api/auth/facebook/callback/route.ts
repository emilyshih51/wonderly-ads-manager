import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setSession } from '@/lib/session';
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
  const state = request.nextUrl.searchParams.get('state');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=no_code`);
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get('wonderly_oauth_state')?.value;

  cookieStore.delete('wonderly_oauth_state');

  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(`${appUrl}/login?error=invalid_state`);
  }

  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      return NextResponse.redirect(`${appUrl}/login?error=missing_config`);
    }

    const redirectUri = `${appUrl}/api/auth/facebook/callback`;

    const tokenData = await MetaService.exchangeCodeForToken(appId, appSecret, code, redirectUri);

    if (tokenData.error || !tokenData.access_token) {
      return NextResponse.redirect(`${appUrl}/login?error=token_error`);
    }

    const longLivedData = await MetaService.exchangeForLongLivedToken(
      appId,
      appSecret,
      tokenData.access_token
    );
    const accessToken = longLivedData.access_token ?? tokenData.access_token;

    const userData = await MetaService.getMe(accessToken);

    logger.info('Facebook user data', {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      hasError: !!userData.error,
      error: userData.error,
    });

    // Allowlist check — only let authorized users in
    const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
      .replace(/^["']|["']$/g, '') // strip wrapping quotes from env value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = (userData.email ?? '').toLowerCase();

    logger.info('Login attempt', {
      email: userEmail,
      allowedEmails,
      rawEnv: process.env.ALLOWED_EMAILS,
    });

    if (allowedEmails.length > 0 && userEmail && !allowedEmails.includes(userEmail)) {
      logger.warn('Login rejected — email not in allowlist', {
        email: userEmail,
        allowedEmails,
      });

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

    await setSession(session);

    return NextResponse.redirect(`${appUrl}/dashboard`);
  } catch (error) {
    logger.error('Facebook auth error', error);

    return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
  }
}
