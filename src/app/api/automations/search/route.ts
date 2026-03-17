import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi, getAdLevelInsights, getCampaignOptimizationMap } from '@/lib/meta-api';

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
  const rawAdAccountId = session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken || !rawAdAccountId) {
    return NextResponse.json({ error: 'No Meta credentials' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const type = searchParams.get('type') || 'campaigns';
  const query = (searchParams.get('q') || '').toLowerCase();
  const campaignId = searchParams.get('campaign_id');

  try {
    if (type === 'campaigns') {
      const data = await metaApi(`/act_${rawAdAccountId}/campaigns`, accessToken, {
        params: {
          fields: 'id,name,status,objective',
          limit: '100',
          filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
        },
      });

      let campaigns = data.data || [];
      if (query) {
        campaigns = campaigns.filter((c: any) => c.name.toLowerCase().includes(query));
      }

      return NextResponse.json({
        data: campaigns.map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective,
        })),
      });
    }

    if (type === 'adsets') {
      const endpoint = campaignId
        ? `/${campaignId}/adsets`
        : `/act_${rawAdAccountId}/adsets`;

      const data = await metaApi(endpoint, accessToken, {
        params: {
          fields: 'id,name,status,campaign_id,campaign{name}',
          limit: '100',
          filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
        },
      });

      let adsets = data.data || [];
      if (query) {
        adsets = adsets.filter((a: any) => a.name.toLowerCase().includes(query));
      }

      return NextResponse.json({
        data: adsets.map((a: any) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          campaign_id: a.campaign_id,
          campaign_name: a.campaign?.name,
        })),
      });
    }

    if (type === 'preview') {
      // Preview matching ads based on conditions
      const conditionsJson = searchParams.get('conditions');
      const datePreset = searchParams.get('date_preset') || 'today';
      const conditions: Array<{ metric: string; operator: string; threshold: string }> = conditionsJson
        ? JSON.parse(conditionsJson)
        : [];

      // Fetch ad-level insights — only for ACTIVE ads (skip paused/off ads)
      let insightsData: any[] = [];
      const activeFilter = JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }]);

      if (campaignId) {
        const response = await metaApi(`/${campaignId}/insights`, accessToken, {
          params: {
            fields: 'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,date_start,date_stop',
            date_preset: datePreset,
            level: 'ad',
            limit: '500',
            filtering: activeFilter,
          },
        });
        insightsData = response.data || [];
      } else {
        const response = await metaApi(`/act_${rawAdAccountId}/insights`, accessToken, {
          params: {
            fields: 'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,date_start,date_stop',
            date_preset: datePreset,
            level: 'ad',
            limit: '500',
            filtering: activeFilter,
          },
        });
        insightsData = response.data || [];
      }

      // Get optimization map for result counting
      let optimizationMap: Record<string, string> = {};
      try {
        optimizationMap = await getCampaignOptimizationMap(rawAdAccountId, accessToken);
      } catch { /* continue without */ }

      // Evaluate conditions
      const matchingAds = insightsData
        .map((row: any) => {
          const spend = parseFloat(row.spend || '0');
          const cId = row.campaign_id;
          const resultCount = getResultCount(row, cId, optimizationMap);
          const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

          const metrics: Record<string, number> = {
            spend,
            impressions: parseInt(row.impressions || '0'),
            clicks: parseInt(row.clicks || '0'),
            ctr: parseFloat(row.ctr || '0'),
            cpc: parseFloat(row.cpc || '0'),
            cpm: parseFloat(row.cpm || '0'),
            frequency: parseFloat(row.frequency || '0'),
            results: resultCount,
            cost_per_result: costPerResult === Infinity ? 99999 : costPerResult,
          };

          // Check ALL conditions (AND logic)
          const allMet = conditions.every((cond) => {
            // Skip CPA conditions when results=0 — CPA is undefined, not infinitely high
            if (cond.metric === 'cost_per_result' && resultCount === 0) {
              return false;
            }
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
    console.error('[Automations Search]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function getResultCount(row: any, campaignId: string, optimizationMap: Record<string, string>): number {
  if (!row.actions || !Array.isArray(row.actions)) return 0;
  const resultType = campaignId && optimizationMap[campaignId];
  if (resultType) {
    const found = row.actions.find((a: any) => a.action_type === resultType);
    return found ? parseInt(found.value) || 0 : 0;
  }
  const conversion = row.actions.find((a: any) =>
    (a.action_type.startsWith('offsite_conversion.') ||
     a.action_type.startsWith('onsite_conversion.') ||
     a.action_type === 'lead' ||
     a.action_type === 'complete_registration') &&
    !a.action_type.includes('post_engagement') &&
    !a.action_type.includes('page_engagement') &&
    !a.action_type.includes('link_click')
  );
  return conversion ? parseInt(conversion.value) || 0 : 0;
}

function evaluateCondition(actual: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '==': return actual === threshold;
    default: return false;
  }
}
