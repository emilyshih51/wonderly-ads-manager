import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getRedisClient } from '@/lib/redis';

interface HistoryEvent {
  id: string;
  rule_name: string;
  type: string;
  matched: number;
  results: Array<{
    entity_id?: string;
    entity_name?: string;
    action?: string;
    metrics?: unknown;
    slack_sent?: boolean;
    slack_channel?: string;
    error?: string;
  }>;
  timestamp: number;
}

const MAX_ENTRIES = 50;

function redisKey(userId: string) {
  return `automation_history:${userId}`;
}

/**
 * GET /api/automations/history
 *
 * Returns automation run history from Redis, sorted by timestamp descending.
 */
export async function GET() {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const redis = await getRedisClient();

  if (!redis) {
    return NextResponse.json({ data: [] });
  }

  const raw = await redis.lRange(redisKey(session.id), 0, -1);
  const history: HistoryEvent[] = [];

  for (const entry of raw) {
    try {
      history.push(JSON.parse(entry));
    } catch {
      /* skip malformed entries */
    }
  }

  history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return NextResponse.json({ data: history });
}

/**
 * POST /api/automations/history
 *
 * Log a new automation run event.
 * Body: { rule_name, type, matched, results, timestamp? }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const redis = await getRedisClient();

  if (!redis) {
    return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
  }

  const body = (await request.json()) as Partial<{
    rule_name: string;
    type: string;
    matched: number;
    results: HistoryEvent['results'];
    timestamp: number;
  }>;

  const event: HistoryEvent = {
    id: `run_${Date.now()}`,
    rule_name: body.rule_name || 'Unknown',
    type: body.type || 'test',
    matched: body.matched || 0,
    results: (body.results || []).slice(0, 10).map((r) => ({
      entity_id: r.entity_id,
      entity_name: r.entity_name,
      action: r.action,
      metrics: r.metrics,
      slack_sent: r.slack_sent,
      slack_channel: r.slack_channel,
      error: r.error,
    })),
    timestamp: body.timestamp || Date.now(),
  };

  const key = redisKey(session.id);

  await redis.lPush(key, JSON.stringify(event));
  await redis.lTrim(key, 0, MAX_ENTRIES - 1);

  return NextResponse.json({ success: true, event });
}

/**
 * DELETE /api/automations/history
 *
 * Clear all history for the current user.
 */
export async function DELETE() {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const redis = await getRedisClient();

  if (!redis) {
    return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
  }

  await redis.del(redisKey(session.id));

  return NextResponse.json({ success: true });
}
