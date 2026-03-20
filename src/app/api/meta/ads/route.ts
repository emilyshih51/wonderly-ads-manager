import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { attachInsights } from '@/lib/utils';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Ads');

/**
 * GET /api/meta/ads
 *
 * Returns ads for the authenticated ad account, optionally filtered
 * by ad set or fetched with custom fields.
 *
 * Query params:
 * - `adset_id` — Filter to a specific ad set
 * - `date_preset` — Meta date preset (default: `today`)
 * - `with_insights=true` — Attach per-ad insights
 * - `fields` — Custom field list (requires adset_id)
 */
export async function GET(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const adSetId = request.nextUrl.searchParams.get('adset_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';
  const customFields = request.nextUrl.searchParams.get('fields');

  const meta = MetaService.fromSession(session);

  try {
    let data;

    if (customFields && adSetId) {
      data = await meta.request(`/${adSetId}/ads`, {
        params: { fields: customFields, limit: '5' },
      });
    } else {
      data = await meta.getAds(adSetId);
    }

    const ads = (data as { data?: Array<{ id: string }> }).data || [];

    if (withInsights) {
      try {
        const bulkInsights = await meta.getAdLevelInsights(datePreset);

        return NextResponse.json({ data: attachInsights(ads, bulkInsights.data || [], 'ad_id') });
      } catch {
        return NextResponse.json({
          data: ads.map((a) => ({ ...a, insights: null })),
        });
      }
    }

    return NextResponse.json({ data: ads });
  } catch (error) {
    logger.error('Ad fetch error', error);

    return NextResponse.json({ error: 'Failed to fetch ads' }, { status: 500 });
  }
}
