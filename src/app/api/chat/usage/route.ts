import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getRedisClient } from '@/lib/redis';
import { UsageTrackerService } from '@/services/usage-tracker';
import { createLogger } from '@/services/logger';

const logger = createLogger('ChatUsage');

/**
 * GET /api/chat/usage — Fetch token usage for the authenticated user.
 *
 * Query params:
 * - days: number of days of history to return (default 7, max 30)
 *
 * @returns Daily usage array with token counts and estimated costs
 */
export async function GET(request: Request) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  try {
    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 30);

    const redis = await getRedisClient();
    const tracker = new UsageTrackerService(redis);
    const history = await tracker.getUsageHistory(session.id, days);

    const today = history[0] ?? {
      date: new Date().toISOString().slice(0, 10),
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost: 0,
    };

    return NextResponse.json({
      today,
      history,
    });
  } catch (error) {
    logger.error('Failed to fetch usage data', error);

    return NextResponse.json({ error: 'Failed to fetch usage data' }, { status: 500 });
  }
}
