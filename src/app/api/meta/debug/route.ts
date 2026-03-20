import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi } from '@/lib/meta-api';

/**
 * Debug endpoint: Returns raw Meta API data for campaigns and ad sets
 * with date_preset=today so we can compare with Meta Ads Manager.
 *
 * GET /api/meta/debug
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const results: Record<string, unknown> = {
    ad_account_id: session.ad_account_id,
    timestamp: new Date().toISOString(),
  };

  // 1. Fetch campaigns
  try {
    const campaigns = await metaApi(
      `/act_${session.ad_account_id}/campaigns`,
      session.meta_access_token,
      {
        params: { fields: 'id,name,status,objective', limit: '50' },
      }
    );
    results.campaigns = campaigns.data;

    // 2. For each campaign, fetch insights with date_preset=today
    const campaignInsights = await Promise.all(
      (campaigns.data || []).map(async (c: { id: string; name: string }) => {
        try {
          const insights = await metaApi(`/${c.id}/insights`, session.meta_access_token, {
            params: {
              fields:
                'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,date_start,date_stop',
              date_preset: 'today',
            },
          });
          return {
            campaign_id: c.id,
            campaign_name: c.name,
            insights_rows: insights.data,
            raw_response: insights,
          };
        } catch (err) {
          return {
            campaign_id: c.id,
            campaign_name: c.name,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    results.campaign_insights = campaignInsights;
  } catch (err) {
    results.campaigns_error = err instanceof Error ? err.message : String(err);
  }

  // 3. Fetch ad sets
  try {
    const adSets = await metaApi(
      `/act_${session.ad_account_id}/adsets`,
      session.meta_access_token,
      {
        params: {
          fields: 'id,name,campaign_id,status,daily_budget',
          limit: '50',
        },
      }
    );
    results.adsets = adSets.data;
  } catch (err) {
    results.adsets_error = err instanceof Error ? err.message : String(err);
  }

  // 4. Fetch ad sets with the FULL field list (to see if that's what fails)
  try {
    const adSetsFull = await metaApi(
      `/act_${session.ad_account_id}/adsets`,
      session.meta_access_token,
      {
        params: {
          fields:
            'id,name,campaign_id,campaign{name},status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,created_time,updated_time',
          limit: '50',
        },
      }
    );
    results.adsets_full_fields = { count: adSetsFull.data?.length, success: true };
  } catch (err) {
    results.adsets_full_fields_error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
