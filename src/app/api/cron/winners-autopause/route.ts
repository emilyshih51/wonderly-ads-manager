/**
 * GET /api/cron/winners-autopause
 *
 * Daily check of the Winners campaign (see `src/lib/winners-autopause.ts` for the rules and
 * `src/lib/winners-autopause-runner.ts` for the safety rails). Runs once a day on completed
 * days only — see vercel.json.
 *
 * Does nothing when stopped from the Auto-pause page or when `WINNERS_AUTOPAUSE_DISABLED=1`.
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import { envKillSwitch, loadSettings, runAutopause } from '@/lib/winners-autopause-runner';
import { createLogger } from '@/services/logger';

const logger = createLogger('WinnersAutopauseCron');

export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  if (envKillSwitch()) {
    logger.info('Skipped — WINNERS_AUTOPAUSE_DISABLED is set');

    return NextResponse.json({ ok: true, skipped: 'env_kill_switch' });
  }

  const { settings } = await loadSettings();

  if (!settings.enabled) {
    logger.info('Skipped — stopped from the Auto-pause page');

    return NextResponse.json({ ok: true, skipped: 'stopped' });
  }

  try {
    const run = await runAutopause('cron');

    return NextResponse.json({
      ok: true,
      dryRun: run.settings.dryRun,
      checked: run.evaluations.length,
      wouldPause: run.evaluations.filter((e) => e.decision === 'PAUSE').length,
      paused: run.paused.length,
      overLimit: run.overLimit,
    });
  } catch (error) {
    logger.error('Winners auto-pause run failed — nothing paused', error);

    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
