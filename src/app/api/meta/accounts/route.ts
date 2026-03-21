import { NextRequest, NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { metaErrorResponse } from '@/lib/meta-error-response';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Accounts');

interface AdAccountRow {
  id: string;
  name: string;
  account_status: number;
  business?: { name: string };
}

/**
 * GET /api/meta/accounts — List all ad accounts the user has access to
 * POST /api/meta/accounts — Switch to a different ad account
 */

export async function GET() {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  try {
    const meta = new MetaService(session.meta_access_token, '');
    const data = await meta.request<{ data?: AdAccountRow[] }>('/me/adaccounts', {
      params: { fields: 'id,name,account_status,business{name}' },
    });

    const accounts = (data.data ?? []).map((acc) => ({
      id: acc.id.replace('act_', ''),
      name: acc.name,
      business_name: acc.business?.name ?? null,
      account_status: acc.account_status,
      is_current: acc.id.replace('act_', '') === session.ad_account_id,
    }));

    return NextResponse.json({ data: accounts, current: session.ad_account_id });
  } catch (error) {
    logger.error('Fetch accounts error', error);

    return metaErrorResponse(error, 'Failed to fetch ad accounts');
  }
}

export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  try {
    const { ad_account_id } = await request.json();

    if (!ad_account_id) {
      return NextResponse.json({ error: 'ad_account_id required' }, { status: 400 });
    }

    const normalizedId = ad_account_id.replace('act_', '');

    // Verify the user owns this ad account before switching
    const userAccounts = await MetaService.getMyAdAccounts(session.meta_access_token);
    const ownsAccount = userAccounts.data?.some(
      (acc) => acc.id.replace('act_', '') === normalizedId
    );

    if (!ownsAccount) {
      return NextResponse.json({ error: 'Access denied to this ad account' }, { status: 403 });
    }

    await setSession({
      ...session,
      ad_account_id: normalizedId,
    });

    return NextResponse.json({
      success: true,
      ad_account_id: normalizedId,
    });
  } catch (error) {
    logger.error('Switch account error', error);

    return metaErrorResponse(error, 'Failed to switch account');
  }
}
