import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { attachInsights } from '@/lib/utils';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:AdSets');

/**
 * GET /api/meta/adsets
 *
 * Returns ad sets for the authenticated ad account, optionally filtered
 * by campaign.
 *
 * Query params:
 * - `campaign_id` — Filter to a specific campaign
 * - `date_preset` — Meta date preset (default: `today`)
 * - `with_insights=true` — Attach per-ad-set insights
 */
export async function GET(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const campaignId = request.nextUrl.searchParams.get('campaign_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  const meta = MetaService.fromSession(session);

  try {
    const data = await meta.getAdSets(campaignId);
    const adsets = data.data || [];

    if (withInsights) {
      try {
        const bulkInsights = await meta.getAdSetLevelInsights(datePreset);

        return NextResponse.json({
          data: attachInsights(adsets, bulkInsights.data || [], 'adset_id'),
        });
      } catch {
        return NextResponse.json({
          data: adsets.map((a) => ({ ...a, insights: null })),
        });
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    logger.error('Ad set fetch error', error);

    return NextResponse.json({ error: 'Failed to fetch ad sets' }, { status: 500 });
  }
}
