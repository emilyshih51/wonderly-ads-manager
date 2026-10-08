/**
 * GET /api/cron/winners-auto-pause
 *
 * Once a day, checks every active ad in the Remodeling Winners campaign against the three
 * rules in the "Winners Campaign Auto-Pause Spec" (Notion, Growth HQ) and pauses the ones
 * that can't hit the $250 cost-per-trial target. Posts one summary to Slack per run. See
 * `src/lib/winners-auto-pause.ts` for the rules themselves.
 *
 * **Dry run by default.** Nothing is paused unless `WINNERS_AUTOPAUSE_LIVE=true`; until
 * then the Slack post says "would pause" so the calls can be checked by hand first.
 *
 * Env:
 * - `WINNERS_CAMPAIGN_ID` (required) — the Remodeling Winners campaign
 * - `WINNERS_AUTOPAUSE_SLACK_CHANNEL` — where to post (falls back to `SLACK_NOTIFICATION_CHANNEL`)
 * - `WINNERS_AUTOPAUSE_LIVE` — `true` to actually pause ads
 * - `WINNERS_AUTOPAUSE_MAX_PAUSES` — safety cap on pauses per run (default 10)
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import { buildAdsManagerAdLink } from '@/lib/ads-manager-link';
import { WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID } from '@/lib/growth-config';
import {
  evaluateWinnersAd,
  groupDailyRowsByAd,
  todayInTimezone,
  toWinnersSlackMessage,
  type WinnersAdResult,
} from '@/lib/winners-auto-pause';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';
import { createSlackService } from '@/services/slack';

const logger = createLogger('WinnersAutoPauseCron');

export const maxDuration = 60;

const DEFAULT_MAX_PAUSES = 10;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const auth = request.headers.get('authorization');

    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const campaignId = process.env.WINNERS_CAMPAIGN_ID;

  if (!campaignId) {
    return NextResponse.json({ error: 'WINNERS_CAMPAIGN_ID is not configured' }, { status: 503 });
  }

  const dryRun = process.env.WINNERS_AUTOPAUSE_LIVE !== 'true';
  const maxPauses =
    parseInt(process.env.WINNERS_AUTOPAUSE_MAX_PAUSES || '', 10) || DEFAULT_MAX_PAUSES;
  const meta = new MetaService(process.env.META_SYSTEM_ACCESS_TOKEN ?? '', WONDERLY_AD_ACCOUNT_ID);

  try {
    const [account, rows, statusMap] = await Promise.all([
      meta.getAdAccount(),
      meta.getAdDailyInsightsForCampaign(campaignId),
      meta.getAdEffectiveStatusMap(),
    ]);

    // Meta reports days in the ad account's timezone, so "today" (Rule 3) must too.
    const today = todayInTimezone(account.timezone_name);
    // Only ads that are actually delivering — paused ones have nothing left to pause.
    const activeAds = groupDailyRowsByAd(rows).filter((ad) => statusMap[ad.adId] === 'ACTIVE');
    const results: WinnersAdResult[] = activeAds.map((ad) => ({
      adId: ad.adId,
      adName: ad.adName,
      verdict: evaluateWinnersAd(ad.days, today),
    }));

    const toPause = results.filter((r) => r.verdict.action === 'pause');

    if (!dryRun) {
      if (toPause.length > maxPauses) {
        logger.warn('More ads failed than the per-run cap — pausing only the first batch', {
          failing: toPause.length,
          maxPauses,
        });
      }

      // Worst spenders first, so the cap (if hit) stops the most money.
      const batch = [...toPause]
        .sort((a, b) => b.verdict.spend - a.verdict.spend)
        .slice(0, maxPauses);

      for (const r of batch) {
        try {
          await meta.updateStatus(r.adId, 'PAUSED');
          r.paused = true;
        } catch (error) {
          r.paused = false;
          r.error = String(error);
          logger.error(`Failed to pause ad ${r.adId}`, error);
        }
      }
    }

    const channel =
      process.env.WINNERS_AUTOPAUSE_SLACK_CHANNEL || process.env.SLACK_NOTIFICATION_CHANNEL;
    let slackSent = false;

    if (channel) {
      const text = toWinnersSlackMessage(results, {
        dryRun,
        adLink: (adId) => buildAdsManagerAdLink(WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID, adId),
      });

      slackSent = (await createSlackService().postMessage(channel, text)) !== null;
    } else {
      logger.warn('No Slack channel configured — results only in the response body');
    }

    logger.info('Winners auto-pause run complete', {
      dryRun,
      checked: results.length,
      flagged: toPause.length,
      paused: results.filter((r) => r.paused).length,
    });

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      today,
      checked: results.length,
      flagged: toPause.length,
      slack_sent: slackSent,
      results,
    });
  } catch (error) {
    logger.error('Winners auto-pause run failed', error);

    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
