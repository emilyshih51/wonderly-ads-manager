import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * GET /api/automations/history
 *
 * Returns automation run history stored in cookies.
 * Each run is stored as a separate cookie (wonderly_history_{timestamp}).
 * We keep the last 30 entries.
 */
export async function GET() {
  const cookieStore = await cookies();
  const history: any[] = [];

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
  const body = await request.json();

  const event = {
    id: `run_${Date.now()}`,
    rule_name: body.rule_name || 'Unknown',
    type: body.type || 'test', // 'test' | 'live'
    matched: body.matched || 0,
    results: (body.results || []).slice(0, 10).map((r: any) => ({
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
    httpOnly: false,
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
  const cookieStore = await cookies();
  const response = NextResponse.json({ success: true });

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('wonderly_history_')) {
      response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
  }

  return response;
}
