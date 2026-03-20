import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Insights');

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
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const timeIncrement = request.nextUrl.searchParams.get('time_increment') || undefined;

  const meta = MetaService.fromSession(session);

  try {
    const data = await meta.getAccountInsights(datePreset, timeIncrement);

    return NextResponse.json(data);
  } catch (error) {
    logger.error('Insights fetch error', error);

    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 });
  }
}
