import { NextRequest, NextResponse } from 'next/server';
import { getSession, setSession } from '@/lib/session';
import { metaApi } from '@/lib/meta-api';

/**
 * GET /api/meta/accounts — List all ad accounts the user has access to
 * POST /api/meta/accounts — Switch to a different ad account
 */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status,business{name}&access_token=${session.meta_access_token}`
    );
    const data = await response.json();

    const accounts = (data.data || []).map((acc: any) => ({
      id: acc.id.replace('act_', ''),
      name: acc.name,
      business_name: acc.business?.name || null,
      account_status: acc.account_status,
      is_current: acc.id.replace('act_', '') === session.ad_account_id,
    }));

    return NextResponse.json({ data: accounts, current: session.ad_account_id });
  } catch (error) {
    console.error('Fetch accounts error:', error);
    return NextResponse.json({ error: 'Failed to fetch ad accounts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { ad_account_id } = await request.json();
    if (!ad_account_id) {
      return NextResponse.json({ error: 'ad_account_id required' }, { status: 400 });
    }

    // Update session with new account
    await setSession({
      ...session,
      ad_account_id: ad_account_id.replace('act_', ''),
    });

    return NextResponse.json({ success: true, ad_account_id: ad_account_id.replace('act_', '') });
  } catch (error) {
    console.error('Switch account error:', error);
    return NextResponse.json({ error: 'Failed to switch account' }, { status: 500 });
  }
}
