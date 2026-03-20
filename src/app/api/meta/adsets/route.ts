import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session)
    return NextResponse.json({ error: 'Unauthorized — please log in again' }, { status: 401 });

  const campaignId = request.nextUrl.searchParams.get('campaign_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);

  try {
    const data = await meta.getAdSets(campaignId);
    const adsets = data.data || [];

    if (withInsights) {
      try {
        const bulkInsights = await meta.getAdSetLevelInsights(datePreset);
        const insightsMap: Record<string, unknown> = {};

        for (const row of (bulkInsights as { data?: Array<{ adset_id: string }> }).data || []) {
          insightsMap[row.adset_id] = row;
        }

        const adsetsWithInsights = (adsets as Array<{ id: string }>).map((adset) => ({
          ...adset,
          insights: insightsMap[adset.id] || null,
        }));

        return NextResponse.json({ data: adsetsWithInsights });
      } catch {
        const adsetsNoInsights = (adsets as Array<{ id: string }>).map((a) => ({
          ...a,
          insights: null,
        }));

        return NextResponse.json({ data: adsetsNoInsights });
      }
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';

    console.error('Ad set fetch error:', msg);

    return NextResponse.json({ error: `Failed to fetch ad sets: ${msg}` }, { status: 500 });
  }
}
