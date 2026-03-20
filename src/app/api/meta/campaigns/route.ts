import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Campaigns');

/**
 * GET /api/meta/campaigns
 *
 * Returns all campaigns for the authenticated ad account.
 *
 * Query params:
 * - `date_preset` — Meta date preset (default: `today`)
 * - `with_insights=true` — Attach per-campaign insights and optimization map
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);

  try {
    const data = await meta.getCampaigns();
    const campaigns = data.data || [];

    if (withInsights) {
      try {
        const [bulkInsights, optimizationMap] = await Promise.all([
          meta.getCampaignLevelInsights(datePreset),
          meta.getCampaignOptimizationMap(),
        ]);

        const insightsMap: Record<string, unknown> = {};

        for (const row of (bulkInsights as { data?: Array<{ campaign_id: string }> }).data || []) {
          insightsMap[row.campaign_id] = row;
        }

        const campaignsWithInsights = (campaigns as Array<{ id: string }>).map((campaign) => ({
          ...campaign,
          insights: insightsMap[campaign.id] || null,
          result_action_type: optimizationMap[campaign.id] || null,
        }));

        return NextResponse.json({ data: campaignsWithInsights, optimizationMap });
      } catch (insightsError: unknown) {
        const msg = insightsError instanceof Error ? insightsError.message : 'Unknown';

        logger.error('Bulk campaign insights error', msg);
        const campaignsNoInsights = (campaigns as Array<{ id: string }>).map((c) => ({
          ...c,
          insights: null,
        }));

        return NextResponse.json({ data: campaignsNoInsights });
      }
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Campaign fetch error', msg);

    return NextResponse.json({ error: `Failed to fetch campaigns: ${msg}` }, { status: 500 });
  }
}
