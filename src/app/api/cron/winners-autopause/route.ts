/**
 * GET /api/cron/winners-autopause
 *
 * Daily check of every campaign on the Auto-pause page (Winners by default). Each campaign
 * has its own rules and Off / Dry run / Live switch; stopped campaigns are skipped. See
 * `src/lib/winners-autopause.ts` for the rules and `src/lib/winners-autopause-runner.ts`
 * for the safety rails. Runs once a day on completed days only — see vercel.json.
 *
 * Does nothing at all when `WINNERS_AUTOPAUSE_DISABLED=1`.
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import { envKillSwitch, runAllCampaigns } from '@/lib/winners-autopause-runner';
import { createLogger } from '@/services/logger';

const logger = createLogger('WinnersAutopauseCron');

// Campaigns run one after another; give a few of them room to finish.
export const maxDuration = 300;

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

  const results = await runAllCampaigns();

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    campaigns: results.map(({ campaign, run, skipped, error }) => ({
      id: campaign.id,
      name: campaign.name,
      skipped,
      error,
      dryRun: run?.settings.dryRun,
      checked: run?.evaluations.length,
      wouldPause: run?.evaluations.filter((e) => e.decision === 'PAUSE').length,
      paused: run?.paused.length,
      overLimit: run?.overLimit,
    })),
  });
}
