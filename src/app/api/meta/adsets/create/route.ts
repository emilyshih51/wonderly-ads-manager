import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi } from '@/lib/meta-api';

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Build targeting — if none provided, use a broad default
    const targetingSpec = targeting || {
      geo_locations: { countries: ['US'] },
      age_min: 18,
      age_max: 65,
    };

    const result = await metaApi(
      `/act_${session.ad_account_id}/adsets`,
      session.meta_access_token,
      {
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
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Create ad set error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create ad set';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
