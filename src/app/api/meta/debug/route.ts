import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';

/**
 * GET /api/meta/debug
 *
 * Development/diagnostic endpoint. Returns raw campaign objects, campaign-level
 * insights (today), ad sets, and ad set field coverage for the authenticated
 * account. Useful for verifying Meta API connectivity and field availability.
 */
export async function GET() {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);
  const results: Record<string, unknown> = {
    ad_account_id: session.ad_account_id,
    timestamp: new Date().toISOString(),
  };

  try {
    const campaigns = await meta.request(`/act_${session.ad_account_id}/campaigns`, {
      params: { fields: 'id,name,status,objective', limit: '50' },
    });

    results.campaigns = (campaigns as { data?: unknown }).data;

    const campaignInsights = await Promise.all(
      ((campaigns as { data?: Array<{ id: string; name: string }> }).data || []).map(async (c) => {
        try {
          const insights = await meta.request(`/${c.id}/insights`, {
            params: {
              fields:
                'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,date_start,date_stop',
              date_preset: 'today',
            },
          });

          return {
            campaign_id: c.id,
            campaign_name: c.name,
            insights_rows: (insights as { data?: unknown }).data,
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

  try {
    const adSets = await meta.request(`/act_${session.ad_account_id}/adsets`, {
      params: { fields: 'id,name,campaign_id,status,daily_budget', limit: '50' },
    });

    results.adsets = (adSets as { data?: unknown }).data;
  } catch (err) {
    results.adsets_error = err instanceof Error ? err.message : String(err);
  }

  try {
    const adSetsFull = await meta.request(`/act_${session.ad_account_id}/adsets`, {
      params: {
        fields:
          'id,name,campaign_id,campaign{name},status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,created_time,updated_time',
        limit: '50',
      },
    });

    results.adsets_full_fields = {
      count: (adSetsFull as { data?: unknown[] }).data?.length,
      success: true,
    };
  } catch (err) {
    results.adsets_full_fields_error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
