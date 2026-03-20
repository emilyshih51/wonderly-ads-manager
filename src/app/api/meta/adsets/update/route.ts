import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi } from '@/lib/meta-api';
import { postSlackMessage } from '@/lib/slack';

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL || '';

/**
 * Update budget (and other fields) for an ad set or campaign.
 * Sends Slack notification on budget changes.
 *
 * Body: { adset_id: string, adset_name?: string, daily_budget?: string, previous_budget?: string }
 * Note: `adset_id` can be any Meta entity ID (ad set ID or campaign ID) — it just calls POST /{id}
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const entityId = body.adset_id || body.campaign_id || body.entity_id;
    const entityName = body.adset_name || body.campaign_name || body.entity_name || entityId;
    const { daily_budget, previous_budget } = body;

    if (!entityId) {
      return NextResponse.json(
        { error: 'Entity ID is required (adset_id, campaign_id, or entity_id)' },
        { status: 400 }
      );
    }

    const updateBody: any = {};
    if (daily_budget !== undefined) {
      // Meta expects budget in cents
      updateBody.daily_budget = Math.round(parseFloat(daily_budget) * 100);
    }

    const result = await metaApi(`/${entityId}`, session.meta_access_token, {
      method: 'POST',
      body: updateBody,
    });

    // Send Slack notification for budget change
    if (SLACK_CHANNEL && daily_budget !== undefined) {
      const newBudgetDisplay = `$${parseFloat(daily_budget).toFixed(2)}`;
      let text = `💰 *[Wonderly]* ${entityName} budget changed to ${newBudgetDisplay}/day`;
      if (previous_budget) {
        const prevDisplay = `$${parseFloat(previous_budget).toFixed(2)}`;
        const direction =
          parseFloat(daily_budget) > parseFloat(previous_budget) ? 'raised' : 'lowered';
        text = `💰 *[Wonderly]* ${entityName} ${direction} budget from ${prevDisplay} to ${newBudgetDisplay}/day`;
      }
      try {
        await postSlackMessage(SLACK_CHANNEL, text);
      } catch (e) {
        console.error('[Budget] Slack notification failed:', e);
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const message = error?.metaError?.message || error?.message || 'Update failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
