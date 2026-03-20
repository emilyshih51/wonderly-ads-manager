import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { evaluateCondition, getResultCount } from '@/lib/automation-utils';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';
import type { MetaInsightsRow } from '@/types';

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
  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const rawAdAccountId =
    session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken || !rawAdAccountId) {
    return NextResponse.json({ error: 'No Meta credentials' }, { status: 401 });
  }

  const meta = new MetaService(accessToken, rawAdAccountId);

  const { searchParams } = request.nextUrl;
  const type = searchParams.get('type') || 'campaigns';
  const query = (searchParams.get('q') || '').toLowerCase();
  const campaignId = searchParams.get('campaign_id') ?? undefined;

  try {
    if (type === 'campaigns') {
      const data = await meta.request(`/act_${rawAdAccountId}/campaigns`, {
        params: {
          fields: 'id,name,status,objective',
          limit: '100',
          filtering: JSON.stringify([
            { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
          ]),
        },
      });

      let campaigns = (data as { data?: CampaignResult[] }).data || [];

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

      const data = await meta.request(endpoint, {
        params: {
          fields: 'id,name,status,campaign_id,campaign{name}',
          limit: '100',
          filtering: JSON.stringify([
            { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
          ]),
        },
      });

      let adsets = (data as { data?: AdSetResult[] }).data || [];

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
      const datePreset = searchParams.get('date_preset') || 'today';
      const conditions: Array<{ metric: string; operator: string; threshold: string }> =
        conditionsJson ? (JSON.parse(conditionsJson) as typeof conditions) : [];

      const insightsData = await meta.getFilteredInsights('ad', { datePreset, campaignId });

      let optimizationMap: Record<string, string> = {};

      try {
        optimizationMap = await meta.getCampaignOptimizationMap();
      } catch {
        /* continue without */
      }

      const matchingAds = insightsData
        .map((row: MetaInsightsRow) => {
          const spend = parseFloat(row.spend ?? '0');
          const cId = row.campaign_id ?? '';
          const resultCount = getResultCount(row, cId, optimizationMap);
          const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

          const metrics: Record<string, number> = {
            spend,
            impressions: parseInt(row.impressions ?? '0'),
            clicks: parseInt(row.clicks ?? '0'),
            ctr: parseFloat(row.ctr ?? '0'),
            cpc: parseFloat(row.cpc ?? '0'),
            cpm: parseFloat(row.cpm ?? '0'),
            frequency: parseFloat(row.frequency ?? '0'),
            results: resultCount,
            cost_per_result: costPerResult === Infinity ? 99999 : costPerResult,
          };

          const allMet = conditions.every((cond) => {
            if (cond.metric === 'cost_per_result' && resultCount === 0) return false;

            const actual = metrics[cond.metric] ?? 0;
            const threshold = parseFloat(cond.threshold || '0');

            return evaluateCondition(actual, cond.operator, threshold);
          });

          if (!allMet && conditions.length > 0) return null;

          return {
            ad_id: row.ad_id,
            ad_name: row.ad_name || row.ad_id,
            adset_id: row.adset_id,
            campaign_id: row.campaign_id,
            spend: spend.toFixed(2),
            results: resultCount,
            cpa: costPerResult === Infinity ? 'N/A' : costPerResult.toFixed(2),
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            ctr: metrics.ctr.toFixed(2),
          };
        })
        .filter(Boolean);

      return NextResponse.json({
        matched: matchingAds.length,
        total_ads: insightsData.length,
        data: matchingAds,
      });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    logger.error('Search error', error);

    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
