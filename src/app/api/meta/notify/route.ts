import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { postSlackMessage } from '@/lib/slack';

const SLACK_CHANNEL = process.env.SLACK_NOTIFICATION_CHANNEL || '';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { type } = body;

    if (type === 'launch') {
      const { adset_name, budget, ad_count, status } = body;
      if (!SLACK_CHANNEL) {
        return NextResponse.json({ success: true, slack_sent: false, reason: 'No SLACK_NOTIFICATION_CHANNEL configured' });
      }

      const budgetDisplay = budget ? `$${parseFloat(budget).toFixed(2)}/day` : 'no budget set';
      const statusLabel = status === 'ACTIVE' ? 'Active' : 'Paused (draft)';
      const text = `🚀 *[Wonderly]* ${adset_name} launched with ${budgetDisplay}\n` +
        `${ad_count} ad${ad_count !== 1 ? 's' : ''} created as ${statusLabel}`;

      await postSlackMessage(SLACK_CHANNEL, text);
      return NextResponse.json({ success: true, slack_sent: true });
    }

    return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
  } catch (error: any) {
    console.error('[Notify] Error:', error);
    return NextResponse.json({ error: error?.message || 'Notification failed' }, { status: 500 });
  }
}
