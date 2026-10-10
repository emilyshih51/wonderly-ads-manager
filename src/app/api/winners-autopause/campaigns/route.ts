/**
 * /api/winners-autopause/campaigns — which campaigns have auto-pause rules.
 *
 *   GET    → campaigns in the Wonderly ad account that could be added (active or paused)
 *   POST   → add one: `{ id, name }`. Rules start as a copy of Winners', in Dry run.
 *   DELETE → `?id=<campaign id>` stop running the rules on it (its settings/history are kept)
 */

import { NextRequest, NextResponse } from 'next/server';

import { WONDERLY_AD_ACCOUNT_ID } from '@/lib/growth-config';
import { requireSession } from '@/lib/session';
import { addCampaign, loadCampaigns, removeCampaign } from '@/lib/winners-autopause-runner';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';

const logger = createLogger('WinnersAutopauseCampaigns');

export async function GET() {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  const token = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!token) return NextResponse.json({ error: 'Meta is not configured' }, { status: 503 });

  try {
    const [{ data }, current] = await Promise.all([
      new MetaService(token, WONDERLY_AD_ACCOUNT_ID).getCampaigns(),
      loadCampaigns(),
    ]);
    const taken = new Set(current.map((c) => c.id));
    const available = (data ?? [])
      .filter((c) => (c.status === 'ACTIVE' || c.status === 'PAUSED') && !taken.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, status: c.status }))
      .sort((a, b) =>
        a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'ACTIVE' ? -1 : 1
      );

    return NextResponse.json({ available });
  } catch (error) {
    logger.error('Failed to list campaigns', error);

    return NextResponse.json({ error: 'Could not load campaigns from Meta' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  try {
    const body = (await request.json()) as { id?: string; name?: string };
    const campaigns = await addCampaign(
      { id: String(body.id ?? ''), name: String(body.name ?? '') },
      session.name || session.email || session.id
    );

    return NextResponse.json({ campaigns });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not add campaign' },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  try {
    const campaigns = await removeCampaign(
      request.nextUrl.searchParams.get('id') ?? '',
      session.name || session.email || session.id
    );

    return NextResponse.json({ campaigns });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not remove campaign' },
      { status: 400 }
    );
  }
}
