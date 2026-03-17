import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi } from '@/lib/meta-api';
import { postSlackMessage } from '@/lib/slack';

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL || '';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { adset_id, adset_name, daily_budget, previous_budget } = body;

    if (!adset_id) {
      return NextResponse.json({ error: 'adset_id is required' }, { status: 400 });
    }

    const updateBody: any = {};
    if (daily_budget !== undefined) {
      // Meta expects budget in cents
      updateBody.daily_budget = Math.round(parseFloat(daily_budget) * 100);
    }

    const result = await metaApi(`/${adset_id}`, session.meta_access_token, {
      method: 'POST',
      body: updateBody,
    });

    // Send Slack notification for budget change
    if (SLACK_CHANNEL && daily_budget !== undefined) {
      const newBudgetDisplay = `$${parseFloat(daily_budget).toFixed(2)}`;
      const name = adset_name || adset_id;
      let text = `💰 *[Wonderly]* ${name} budget changed to ${newBudgetDisplay}/day`;
      if (previous_budget) {
        const prevDisplay = `$${parseFloat(previous_budget).toFixed(2)}`;
        const direction = parseFloat(daily_budget) > parseFloat(previous_budget) ? 'raised' : 'lowered';
        text = `💰 *[Wonderly]* ${name} ${direction} budget from ${prevDisplay} to ${newBudgetDisplay}/day`;
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
