import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';

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
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adSetId = request.nextUrl.searchParams.get('adset_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';
  const customFields = request.nextUrl.searchParams.get('fields');

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);

  try {
    let data;

    if (customFields && adSetId) {
      data = await meta.request(`/${adSetId}/ads`, {
        params: { fields: customFields, limit: '5' },
      });
    } else {
      data = await meta.getAds(adSetId);
    }

    const ads = (data as { data?: unknown[] }).data || [];

    if (withInsights) {
      try {
        const bulkInsights = await meta.getAdLevelInsights(datePreset);
        const insightsMap: Record<string, unknown> = {};

        for (const row of (bulkInsights as { data?: Array<{ ad_id: string }> }).data || []) {
          insightsMap[row.ad_id] = row;
        }

        const adsWithInsights = (ads as Array<{ id: string }>).map((ad) => ({
          ...ad,
          insights: insightsMap[ad.id] || null,
        }));

        return NextResponse.json({ data: adsWithInsights });
      } catch {
        const adsNoInsights = (ads as Array<{ id: string }>).map((a) => ({ ...a, insights: null }));

        return NextResponse.json({ data: adsNoInsights });
      }
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';

    console.error('Ad fetch error:', msg);

    return NextResponse.json({ error: `Failed to fetch ads: ${msg}` }, { status: 500 });
  }
}
