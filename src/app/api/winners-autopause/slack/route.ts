/**
 * POST /api/winners-autopause/slack — "Send to Slack" on the Auto-pause page.
 *
 * Posts the summary of the most recent check to the auto-pause Slack channel. Doesn't
 * re-run the check (no extra Meta calls) and never pauses anything.
 */

import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/session';
import { autopauseSlackChannel, loadRuns, postRunToSlack } from '@/lib/winners-autopause-runner';
import { createLogger } from '@/services/logger';

const logger = createLogger('WinnersAutopauseSlack');

export async function POST() {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  if (!autopauseSlackChannel()) {
    return NextResponse.json(
      { error: 'No Slack channel set. Add SLACK_AUTOPAUSE_CHANNEL in Vercel and redeploy.' },
      { status: 400 }
    );
  }

  const [latest] = await loadRuns(1);

  if (!latest) {
    return NextResponse.json(
      { error: 'No check to send yet. Run a check first.' },
      { status: 400 }
    );
  }

  const ok = await postRunToSlack(latest);

  if (!ok) {
    logger.warn('Slack rejected the auto-pause summary');

    return NextResponse.json(
      {
        error:
          "Slack didn't accept the message. Make sure the bot is invited to the channel (/invite @your-bot).",
      },
      { status: 502 }
    );
  }

  logger.info('Auto-pause summary sent to Slack by hand', { by: session.id });

  return NextResponse.json({ ok: true });
}
