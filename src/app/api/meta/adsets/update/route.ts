import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:AdSets');

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL ?? '';

/**
 * POST /api/meta/adsets/update
 *
 * Updates a campaign or ad set (currently supports daily_budget).
 * Posts a Slack notification to `SLACK_NOTIFICATION_CHANNEL` when a budget
 * change is made. Required body field: `adset_id`, `campaign_id`, or `entity_id`.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      adset_id?: string;
      campaign_id?: string;
      entity_id?: string;
      adset_name?: string;
      campaign_name?: string;
      entity_name?: string;
      daily_budget?: string | number;
      previous_budget?: string | number;
    };

    const entityId = body.adset_id ?? body.campaign_id ?? body.entity_id;
    const entityName = body.adset_name ?? body.campaign_name ?? body.entity_name ?? entityId;
    const { daily_budget, previous_budget } = body;

    if (!entityId) {
      return NextResponse.json(
        { error: 'Entity ID is required (adset_id, campaign_id, or entity_id)' },
        { status: 400 }
      );
    }

    const meta = new MetaService(session.meta_access_token, session.ad_account_id);

    if (daily_budget !== undefined) {
      const budgetCents = Math.round(parseFloat(String(daily_budget)) * 100);

      await meta.updateBudget(entityId, budgetCents);
    }

    if (SLACK_CHANNEL && daily_budget !== undefined) {
      const newBudget = parseFloat(String(daily_budget));
      const previousBudget =
        previous_budget !== undefined ? parseFloat(String(previous_budget)) : undefined;

      try {
        const slack = new SlackService(
          process.env.SLACK_BOT_TOKEN ?? '',
          process.env.SLACK_SIGNING_SECRET ?? ''
        );

        await slack.sendBudgetNotification(SLACK_CHANNEL, {
          entityName: entityName ?? entityId,
          newBudget,
          previousBudget,
        });
      } catch (e) {
        logger.error('Slack notification failed', e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const metaError = (error as { metaError?: { message?: string } })?.metaError;
    const message =
      metaError?.message ?? (error instanceof Error ? error.message : 'Update failed');

    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
