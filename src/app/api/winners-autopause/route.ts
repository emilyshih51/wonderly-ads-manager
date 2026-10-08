/**
 * /api/winners-autopause — backs the Auto-pause page.
 *
 *   GET  → current settings, kill-switch state, and recent runs
 *   PUT  → update settings (on/off, dry run, numbers)
 *   POST → "Run check now": evaluates every ad and refreshes the table. Never pauses.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireSession } from '@/lib/session';
import {
  AutopauseRateLimitError,
  envKillSwitch,
  loadRuns,
  loadSettings,
  runAutopause,
  saveSettings,
} from '@/lib/winners-autopause-runner';
import type { AutopauseSettings } from '@/lib/winners-autopause';
import { createLogger } from '@/services/logger';

const logger = createLogger('WinnersAutopauseApi');

export const maxDuration = 120;

export async function GET() {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  const [{ settings, persisted }, runs] = await Promise.all([loadSettings(), loadRuns(10)]);

  return NextResponse.json({ settings, persisted, envKillSwitch: envKillSwitch(), runs });
}

export async function PUT(request: NextRequest) {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  try {
    const patch = (await request.json()) as Partial<AutopauseSettings>;
    const settings = await saveSettings(patch);

    logger.info('Settings updated', { by: session.id, settings });

    return NextResponse.json({ settings });
  } catch (error) {
    logger.error('Failed to save settings', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save' },
      { status: 500 }
    );
  }
}

export async function POST() {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  try {
    const run = await runAutopause('preview');

    return NextResponse.json({ run });
  } catch (error) {
    logger.error('Preview run failed', error);

    if (error instanceof AutopauseRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Run failed' },
      { status: 500 }
    );
  }
}
