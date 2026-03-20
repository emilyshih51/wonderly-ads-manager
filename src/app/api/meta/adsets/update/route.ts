import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:AdSets');

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL || '';

/**
 * POST /api/meta/adsets/update
 *
 * Updates a campaign or ad set (currently supports daily_budget).
 * Posts a Slack notification to SLACK_NOTIFICATION_CHANNEL when a budget
 * change is made. Required body field: `adset_id`, `campaign_id`, or `entity_id`.
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

    const updateBody: Record<string, unknown> = {};

    if (daily_budget !== undefined) {
      updateBody.daily_budget = Math.round(parseFloat(daily_budget) * 100);
    }

    const meta = new MetaService(session.meta_access_token, session.ad_account_id);
    const result = await meta.request(`/${entityId}`, { method: 'POST', body: updateBody });

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
        const slack = new SlackService(
          process.env.SLACK_BOT_TOKEN || '',
          process.env.SLACK_SIGNING_SECRET || ''
        );

        await slack.postMessage(SLACK_CHANNEL, text);
      } catch (e) {
        logger.error('Slack notification failed', e);
      }
    }

    return NextResponse.json({ success: true, ...(result as Record<string, unknown>) });
  } catch (error: unknown) {
    const metaError = (error as { metaError?: { message?: string } })?.metaError;
    const message =
      metaError?.message || (error instanceof Error ? error.message : 'Update failed');

    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
