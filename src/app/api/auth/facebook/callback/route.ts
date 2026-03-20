import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

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

  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(`${process.env.NEXT_PUBLIC_APP_URL}/api/auth/facebook/callback`)}&code=${code}`;

    const tokenResponse = await fetch(tokenUrl);
    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=token_error`);
    }

    // Exchange for long-lived token
    const longLivedUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`;

    const longLivedResponse = await fetch(longLivedUrl);
    const longLivedData = await longLivedResponse.json();
    const accessToken = longLivedData.access_token || tokenData.access_token;

    // Get user info
    const userResponse = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${accessToken}`
    );
    const userData = await userResponse.json();

    // Allowlist check — only let authorized users in
    const allowedEmails = (process.env.ALLOWED_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedEmails.length > 0 && !allowedEmails.includes(userData.email)) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=unauthorized`);
    }

    // Get ad accounts
    const adAccountsResponse = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`
    );
    const adAccountsData = await adAccountsResponse.json();

    // Use the configured ad account or first available
    const configuredAccountId = process.env.META_AD_ACCOUNT_ID;
    let adAccountId = configuredAccountId;

    if (!adAccountId && adAccountsData.data?.length > 0) {
      // Strip the 'act_' prefix if present in the API response
      adAccountId = adAccountsData.data[0].id.replace('act_', '');
    }

    // Store session in cookie
    const session = {
      id: userData.id,
      email: userData.email || '',
      name: userData.name || '',
      meta_access_token: accessToken,
      meta_user_id: userData.id,
      ad_account_id: adAccountId || '',
    };

    const cookieStore = await cookies();

    cookieStore.set('wonderly_session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`);
  } catch (error) {
    console.error('Facebook auth error:', error);

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=auth_failed`);
  }
}
