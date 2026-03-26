import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { metaErrorResponse } from '@/lib/meta-error-response';
import { createLogger } from '@/services/logger';
import { META_BASE_URL } from '@/services/meta/constants';

const logger = createLogger('Meta:Ads');

const AD_CREATIVE_FIELDS =
  'id,name,adset_id,campaign_id,status,creative{id,name,title,body,image_url,thumbnail_url,link_url,call_to_action_type},created_time,updated_time';

/**
 * GET /api/meta/ads
 *
 * Returns ads for the authenticated ad account, optionally filtered
 * by ad set or fetched with custom fields.
 *
 * Query params:
 * - `adset_id` — Filter to a specific ad set
 * - `date_preset` — Meta date preset (default: `today`)
 * - `with_insights=true` — Attach per-ad insights (insights-first approach for account-level queries)
 * - `fields` — Custom field list (requires adset_id)
 */
export async function GET(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const adSetId = request.nextUrl.searchParams.get('adset_id') || undefined;
  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const withInsights = request.nextUrl.searchParams.get('with_insights') === 'true';
  const customFields = request.nextUrl.searchParams.get('fields');

  logger.info('GET /api/meta/ads', { adSetId, datePreset, withInsights });

  const meta = MetaService.fromSession(session);

  try {
    // Ad-set-scoped or custom-fields queries: use the original per-adset approach
    if (adSetId) {
      let data;

      if (customFields) {
        data = await meta.request(`/${adSetId}/ads`, {
          params: { fields: customFields, limit: '5' },
        });
      } else {
        data = await meta.getAds(adSetId);
      }

      const ads = (data as { data?: Array<{ id: string }> }).data || [];

      if (!withInsights) return NextResponse.json({ data: ads });

      try {
        const bulkInsights = await meta.getAdLevelInsights(datePreset);
        const insightsMap = new Map((bulkInsights.data || []).map((row) => [row.ad_id, row]));

        return NextResponse.json({
          data: ads.map((ad) => ({ ...ad, insights: insightsMap.get(ad.id) ?? null })),
        });
      } catch (e) {
        logger.warn('Ad insights fetch failed, returning without insights', e);

        return NextResponse.json({ data: ads.map((a) => ({ ...a, insights: null })) });
      }
    }

    // Account-level query with insights: insights-first so we only return ads
    // that actually had activity in the selected period.
    if (withInsights) {
      const bulkInsights = await meta.getAdLevelInsights(datePreset);
      const insightRows = bulkInsights.data || [];

      if (insightRows.length === 0) {
        return NextResponse.json({ data: [] });
      }

      // Batch-fetch creative/status data for the ads that have insights
      const adIds = insightRows.map((r) => r.ad_id).filter(Boolean) as string[];

      // Meta batch API: up to 50 per request
      const BATCH_SIZE = 50;

      type AdDetail = {
        id: string;
        name?: string;
        adset_id?: string;
        campaign_id?: string;
        status?: string;
        creative?: Record<string, unknown>;
      };
      const allAdDetails: AdDetail[] = [];

      for (let i = 0; i < adIds.length; i += BATCH_SIZE) {
        const chunk = adIds.slice(i, i + BATCH_SIZE);
        const batchBody = chunk.map((id) => ({
          method: 'GET',
          relative_url: `${id}?fields=${AD_CREATIVE_FIELDS}`,
        }));

        const batchUrl = new URL(`${META_BASE_URL}/`);

        batchUrl.searchParams.set('access_token', session.meta_access_token);
        batchUrl.searchParams.set('batch', JSON.stringify(batchBody));

        const batchRes = await fetch(batchUrl.toString(), { method: 'POST', cache: 'no-store' });
        const batchData = (await batchRes.json()) as Array<{ code: number; body: string }>;

        for (const item of batchData) {
          if (item.code === 200) {
            try {
              allAdDetails.push(JSON.parse(item.body) as AdDetail);
            } catch {
              // skip malformed
            }
          }
        }
      }

      const adMap = new Map(allAdDetails.map((ad) => [ad.id, ad]));
      const insightsMap = new Map(insightRows.map((row) => [row.ad_id, row]));

      const merged = adIds
        .map((adId) => {
          const ad = adMap.get(adId);
          const insight = insightsMap.get(adId);

          if (!insight) return null;

          return {
            id: adId,
            name: ad?.name ?? insight.ad_name ?? adId,
            adset_id: ad?.adset_id ?? insight.adset_id ?? '',
            campaign_id: ad?.campaign_id ?? insight.campaign_id ?? '',
            campaign_name: insight.campaign_name,
            status: ad?.status ?? 'UNKNOWN',
            creative: ad?.creative ?? null,
            insights: insight,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ data: merged });
    }

    // No insights requested: plain ad list
    const data = await meta.getAds(undefined);
    const ads = (data as { data?: Array<{ id: string }> }).data || [];

    return NextResponse.json({ data: ads });
  } catch (error) {
    logger.error('Ad fetch error', error);

    return metaErrorResponse(error, 'Failed to fetch ads');
  }
}
