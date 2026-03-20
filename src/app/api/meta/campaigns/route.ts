import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getCampaigns, getCampaignLevelInsights, getCampaignOptimizationMap } from '@/lib/meta-api';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  try {
    const data = await getCampaigns(session.ad_account_id, session.meta_access_token);
    const campaigns = data.data || [];

    if (withInsights) {
      try {
        // Fetch insights AND optimization mapping in parallel
        const [bulkInsights, optimizationMap] = await Promise.all([
          getCampaignLevelInsights(session.ad_account_id, session.meta_access_token, datePreset),
          getCampaignOptimizationMap(session.ad_account_id, session.meta_access_token),
        ]);

        // Build a map of campaign_id -> insights row
        const insightsMap: Record<string, unknown> = {};
        for (const row of bulkInsights.data || []) {
          insightsMap[row.campaign_id] = row;
        }

        // Merge insights + optimization info into campaigns
        const campaignsWithInsights = campaigns.map((campaign: { id: string }) => ({
          ...campaign,
          insights: insightsMap[campaign.id] || null,
          result_action_type: optimizationMap[campaign.id] || null,
        }));

        return NextResponse.json({ data: campaignsWithInsights, optimizationMap });
      } catch (insightsError: unknown) {
        const msg = insightsError instanceof Error ? insightsError.message : 'Unknown';
        console.error('Bulk campaign insights error:', msg);
        const campaignsNoInsights = campaigns.map((c: { id: string }) => ({
          ...c,
          insights: null,
        }));
        return NextResponse.json({ data: campaignsNoInsights });
      }
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Campaign fetch error:', msg);
    return NextResponse.json({ error: `Failed to fetch campaigns: ${msg}` }, { status: 500 });
  }
}
