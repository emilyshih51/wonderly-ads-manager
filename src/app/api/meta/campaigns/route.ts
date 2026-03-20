import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { attachInsights } from '@/lib/utils';
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
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  const meta = MetaService.fromSession(session);

  try {
    const data = await meta.getCampaigns();
    const campaigns = data.data || [];

    if (withInsights) {
      try {
        const [bulkInsights, optimizationMap] = await Promise.all([
          meta.getCampaignLevelInsights(datePreset),
          meta.getCampaignOptimizationMap(),
        ]);

        const campaignsWithInsights = attachInsights(
          campaigns,
          bulkInsights.data || [],
          'campaign_id'
        ).map((c) => ({
          ...c,
          result_action_type: optimizationMap[c.id] || null,
        }));

        return NextResponse.json({ data: campaignsWithInsights, optimizationMap });
      } catch (insightsError) {
        logger.error('Bulk campaign insights error', insightsError);

        return NextResponse.json({
          data: campaigns.map((c) => ({ ...c, insights: null })),
        });
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    logger.error('Campaign fetch error', error);

    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
  }
}
