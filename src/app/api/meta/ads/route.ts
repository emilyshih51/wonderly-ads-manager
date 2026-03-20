import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getAds, getAdLevelInsights, metaApi } from '@/lib/meta-api';

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adSetId = request.nextUrl.searchParams.get('adset_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';
  const customFields = request.nextUrl.searchParams.get('fields');

  try {
    // If custom fields requested (e.g., fetching creative identity), use metaApi directly
    let data;

    if (customFields && adSetId) {
      data = await metaApi(`/${adSetId}/ads`, session.meta_access_token, {
        params: { fields: customFields, limit: '5' },
      });
    } else {
      data = await getAds(session.ad_account_id, session.meta_access_token, adSetId);
    }

    const ads = data.data || [];

    if (withInsights) {
      // Use a SINGLE API call to get insights for ALL ads at once
      try {
        const bulkInsights = await getAdLevelInsights(
          session.ad_account_id,
          session.meta_access_token,
          datePreset
        );

        // Build a map of ad_id -> insights row
        const insightsMap: Record<string, unknown> = {};

        for (const row of bulkInsights.data || []) {
          insightsMap[row.ad_id] = row;
        }

        // Merge insights into ads
        const adsWithInsights = ads.map((ad: { id: string }) => ({
          ...ad,
          insights: insightsMap[ad.id] || null,
        }));

        return NextResponse.json({ data: adsWithInsights });
      } catch {
        // If bulk insights fail, return ads without insights
        const adsNoInsights = ads.map((a: { id: string }) => ({ ...a, insights: null }));

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
