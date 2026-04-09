import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import {
  evaluateCondition,
  parseInsightMetrics,
  COST_PER_RESULT_NO_DATA,
} from '@/lib/automation-utils';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Automations:Search');

interface CampaignResult {
  id: string;
  name: string;
  status: string;
  objective: string;
}

interface AdSetResult {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign?: { name: string };
}

/**
 * GET /api/automations/search
 *
 * Search campaigns, ad sets, and preview matching ads for the automation builder.
 *
 * Query params:
 * - type: 'campaigns' | 'adsets' | 'preview'
 * - q: search query (name contains)
 * - campaign_id: filter ad sets by campaign
 * - For preview: campaign_id, conditions (JSON), date_preset
 */
export async function GET(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const rawAdAccountId = session.ad_account_id;

  const meta = MetaService.fromSession(session);

  const { searchParams } = request.nextUrl;
  const type = searchParams.get('type') || 'campaigns';

  logger.info('GET /api/automations/search', { type });
  const query = (searchParams.get('q') || '').toLowerCase();
  const campaignId = searchParams.get('campaign_id') ?? undefined;

  try {
    if (type === 'campaigns') {
      const data = await meta.request<{ data?: CampaignResult[] }>(
        `/act_${rawAdAccountId}/campaigns`,
        {
          params: {
            fields: 'id,name,status,objective',
            limit: '100',
            filtering: JSON.stringify([
              { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
            ]),
          },
        }
      );

      let campaigns = data.data || [];

      if (query) {
        campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(query));
      }

      return NextResponse.json({
        data: campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective,
        })),
      });
    }

    if (type === 'adsets') {
      const endpoint = campaignId ? `/${campaignId}/adsets` : `/act_${rawAdAccountId}/adsets`;

      const data = await meta.request<{ data?: AdSetResult[] }>(endpoint, {
        params: {
          fields: 'id,name,status,campaign_id,campaign{name}',
          limit: '100',
          filtering: JSON.stringify([
            { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
          ]),
        },
      });

      let adsets = data.data || [];

      if (query) {
        adsets = adsets.filter((a) => a.name.toLowerCase().includes(query));
      }

      return NextResponse.json({
        data: adsets.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          campaign_id: a.campaign_id,
          campaign_name: a.campaign?.name,
        })),
      });
    }

    if (type === 'preview') {
      const conditionsJson = searchParams.get('conditions');
      const datePreset = searchParams.get('date_preset') || 'last_7d';
      const entityType = (searchParams.get('entity_type') || 'ad') as 'ad' | 'adset' | 'campaign';
      let conditions: Array<{ metric: string; operator: string; threshold: string }> = [];

      if (conditionsJson) {
        try {
          conditions = JSON.parse(conditionsJson) as typeof conditions;
        } catch {
          return NextResponse.json({ error: 'Invalid conditions JSON' }, { status: 400 });
        }
      }

      const insightsData = await meta.getFilteredInsights(entityType, { datePreset, campaignId });

      let optimizationMap: Record<string, string> = {};

      try {
        optimizationMap = await meta.getOptimizationMap();
      } catch (e) {
        logger.warn('Optimization map unavailable, continuing without', e);
      }

      const matchingAds = insightsData
        .map((row) => {
          const metrics = parseInsightMetrics(row, optimizationMap);

          // Debug: log when results are 0 but spend > 0 so we can distinguish between
          // an empty actions array (reporting lag) vs a wrong action type (mapping bug)
          if (metrics.results === 0 && metrics.spend > 0) {
            const rowAdsetId = row.adset_id;
            const mappedType = rowAdsetId ? optimizationMap[rowAdsetId] : undefined;

            if (!row.actions?.length) {
              logger.warn(
                'Preview: zero results and empty actions array — possible reporting lag',
                {
                  entity: row.ad_name ?? row.adset_name ?? row.campaign_name ?? row.ad_id,
                  adsetId: rowAdsetId,
                  spend: metrics.spend,
                  mappedResultType: mappedType || 'none',
                }
              );
            } else {
              const actionTypes = row.actions.map((a) => `${a.action_type}=${a.value}`).join(', ');

              logger.warn(
                'Preview: zero results despite spend > 0 — possible action type mismatch',
                {
                  entity: row.ad_name ?? row.adset_name ?? row.campaign_name ?? row.ad_id,
                  adsetId: rowAdsetId,
                  spend: metrics.spend,
                  mappedResultType: mappedType || 'none',
                  actionTypes,
                }
              );
            }
          }

          const allMet = conditions.every((cond) => {
            if (cond.metric === 'cost_per_result' && metrics.results === 0) return false;

            const actual = metrics[cond.metric as keyof typeof metrics] ?? 0;
            const threshold = parseFloat(cond.threshold || '0');

            return evaluateCondition(actual, cond.operator, threshold);
          });

          if (!allMet && conditions.length > 0) return null;

          // Include raw action types and optimization map lookup info for debugging
          const rowAdsetId = row.adset_id;
          const mappedResultType = rowAdsetId ? optimizationMap[rowAdsetId] : undefined;

          return {
            ad_id: row.ad_id,
            ad_name: row.ad_name || row.ad_id,
            adset_id: row.adset_id,
            campaign_id: row.campaign_id,
            campaign_name: row.campaign_name || '',
            spend: metrics.spend.toFixed(2),
            results: metrics.results,
            cpa:
              metrics.cost_per_result === COST_PER_RESULT_NO_DATA
                ? 'N/A'
                : metrics.cost_per_result.toFixed(2),
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            ctr: metrics.ctr.toFixed(2),
            _debug: {
              mapped_result_type: mappedResultType || null,
              raw_actions: row.actions?.map((a) => ({
                type: a.action_type,
                value: a.value,
              })),
            },
          };
        })
        .filter(Boolean);

      // Include a sample of raw data: top 5 ads by spend (most likely to have conversions)
      // so we can diagnose result-counting mismatches against Ads Manager.
      const sortedBySpend = [...insightsData].sort(
        (a, b) => parseFloat(b.spend || '0') - parseFloat(a.spend || '0')
      );
      const debugSample = sortedBySpend.slice(0, 5).map((row) => {
        const rowAdsetId = row.adset_id;
        const mappedType = rowAdsetId ? optimizationMap[rowAdsetId] : undefined;
        const metrics = parseInsightMetrics(row, optimizationMap);

        return {
          ad_name: row.ad_name || row.ad_id,
          adset_id: row.adset_id,
          spend: metrics.spend.toFixed(2),
          computed_results: metrics.results,
          mapped_result_type: mappedType || null,
          raw_actions: row.actions?.map((a) => ({ type: a.action_type, value: a.value })) ?? null,
          actions_count: row.actions?.length ?? 0,
        };
      });

      return NextResponse.json({
        matched: matchingAds.length,
        total_ads: insightsData.length,
        data: matchingAds,
        _debug_sample: debugSample,
      });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    logger.error('Search error', error);

    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
