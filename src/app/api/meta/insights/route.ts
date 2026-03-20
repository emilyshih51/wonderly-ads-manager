import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';

/**
 * GET /api/meta/insights
 *
 * Returns account-level insights for the authenticated ad account.
 *
 * Query params:
 * - `date_preset` — Meta date preset (default: `today`)
 * - `time_increment` — Breakdown granularity (e.g. `1` for daily)
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const timeIncrement = request.nextUrl.searchParams.get('time_increment') || undefined;

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);

  try {
    const data = await meta.getAccountInsights(datePreset, timeIncrement);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Insights fetch error:', error);

    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 });
  }
}
