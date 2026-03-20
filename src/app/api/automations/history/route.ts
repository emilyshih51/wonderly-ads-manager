import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

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

/**
 * GET /api/automations/history
 *
 * Returns automation run history stored in cookies.
 * Each run is stored as a separate cookie (wonderly_history_{timestamp}).
 * We keep the last 30 entries.
 */
export async function GET() {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = await cookies();
  const history: HistoryEvent[] = [];

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('wonderly_history_')) {
      try {
        history.push(JSON.parse(cookie.value));
      } catch {
        /* skip */
      }
    }
  }

  // Sort by timestamp descending (most recent first)
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

  const cookieStore = await cookies();
  const response = NextResponse.json({ success: true, event });

  // Store this event
  response.cookies.set(`wonderly_history_${event.id}`, JSON.stringify(event), {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  });

  // Clean up old entries (keep last 30)
  const existing: string[] = [];

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('wonderly_history_')) {
      existing.push(cookie.name);
    }
  }

  if (existing.length > 29) {
    // Sort by name (which contains timestamp) and remove oldest
    existing.sort();
    const toRemove = existing.slice(0, existing.length - 29);

    for (const name of toRemove) {
      response.cookies.set(name, '', { path: '/', maxAge: 0 });
    }
  }

  return response;
}

/**
 * DELETE /api/automations/history
 *
 * Clear all history.
 */
export async function DELETE() {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = await cookies();
  const response = NextResponse.json({ success: true });

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('wonderly_history_')) {
      response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
  }

  return response;
}
