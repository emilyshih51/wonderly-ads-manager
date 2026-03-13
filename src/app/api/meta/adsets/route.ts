import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getAdSets, getAdSetLevelInsights } from '@/lib/meta-api';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized — please log in again' }, { status: 401 });

  const campaignId = request.nextUrl.searchParams.get('campaign_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  try {
    const data = await getAdSets(session.ad_account_id, session.meta_access_token, campaignId);
    const adsets = data.data || [];

    if (withInsights) {
      // Use a SINGLE API call to get insights for ALL ad sets at once
      // instead of N separate calls (which hits rate limits)
      try {
        const bulkInsights = await getAdSetLevelInsights(
          session.ad_account_id,
          session.meta_access_token,
          datePreset
        );

        // Build a map of adset_id -> insights row
        const insightsMap: Record<string, unknown> = {};
        for (const row of bulkInsights.data || []) {
          insightsMap[row.adset_id] = row;
        }

        // Merge insights into ad sets
        const adsetsWithInsights = adsets.map((adset: { id: string }) => ({
          ...adset,
          insights: insightsMap[adset.id] || null,
        }));

        return NextResponse.json({ data: adsetsWithInsights });
      } catch {
        // If bulk insights fail, return ad sets without insights
        const adsetsNoInsights = adsets.map((a: { id: string }) => ({ ...a, insights: null }));
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
