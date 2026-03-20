import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:AdSets');

/**
 * POST /api/meta/adsets/create
 *
 * Creates a new ad set under a campaign. Required body fields:
 * `name`, `campaign_id`. Optional: `daily_budget`, `optimization_goal`,
 * `billing_event`, `status`, `targeting`.
 */
export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  try {
    const body = await request.json();
    const {
      name,
      campaign_id,
      daily_budget,
      optimization_goal = 'LINK_CLICKS',
      billing_event = 'IMPRESSIONS',
      status = 'PAUSED',
      targeting,
    } = body;

    if (!name || !campaign_id) {
      return NextResponse.json(
        { error: 'Missing required fields: name, campaign_id' },
        { status: 400 }
      );
    }

    const targetingSpec = targeting || {
      geo_locations: { countries: ['US'] },
      age_min: 18,
      age_max: 65,
    };

    const meta = MetaService.fromSession(session);
    const result = await meta.request(`/act_${session.ad_account_id}/adsets`, {
      method: 'POST',
      body: {
        name,
        campaign_id,
        status,
        optimization_goal,
        billing_event,
        targeting: targetingSpec,
        ...(daily_budget && { daily_budget }),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Create ad set error', error);
    const message = error instanceof Error ? error.message : 'Failed to create ad set';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
