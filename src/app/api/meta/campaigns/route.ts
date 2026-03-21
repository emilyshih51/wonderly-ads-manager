import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { attachInsights } from '@/lib/utils';
import { metaErrorResponse } from '@/lib/meta-error-response';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Campaigns');

/**
 * GET /api/meta/campaigns
 *
 * Returns all campaigns for the authenticated ad account.
 *
 * Query params:
 * - `date_preset` — Meta date preset (default: `today`)
 * - `since` + `until` — ISO date range for prior-period comparisons (overrides date_preset)
 * - `with_insights=true` — Attach per-campaign insights and optimization map
 */
export async function GET(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const since = request.nextUrl.searchParams.get('since');
  const until = request.nextUrl.searchParams.get('until');
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';

  const meta = MetaService.fromSession(session);

  try {
    const data = await meta.getCampaigns();
    const campaigns = data.data || [];

    if (withInsights) {
      try {
        const insightsPromise =
          since && until
            ? meta.getInsightsForDateRange(since, until, 'campaign')
            : meta.getCampaignLevelInsights(datePreset);

        // Fetch insights and optimization map independently so one failure
        // doesn't discard the other's data (optimization map is non-critical).
        const [bulkInsightsResult, optimizationMapResult] = await Promise.allSettled([
          insightsPromise,
          meta.getCampaignOptimizationMap(),
        ]);

        const bulkInsights =
          bulkInsightsResult.status === 'fulfilled' ? bulkInsightsResult.value : null;
        const optimizationMap =
          optimizationMapResult.status === 'fulfilled' ? optimizationMapResult.value : {};

        if (optimizationMapResult.status === 'rejected') {
          logger.error('Optimization map error (non-fatal)', optimizationMapResult.reason);
        }

        if (!bulkInsights) {
          // Insights themselves failed — return campaigns without insights
          if (bulkInsightsResult.status === 'rejected') {
            logger.error('Bulk campaign insights error', bulkInsightsResult.reason);
          }

          return NextResponse.json({
            data: campaigns.map((c) => ({ ...c, insights: null, result_action_type: null })),
          });
        }

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
          data: campaigns.map((c) => ({ ...c, insights: null, result_action_type: null })),
        });
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    logger.error('Campaign fetch error', error);

    return metaErrorResponse(error, 'Failed to fetch campaigns');
  }
}
