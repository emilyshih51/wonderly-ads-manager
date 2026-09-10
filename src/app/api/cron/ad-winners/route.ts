/**
 * GET /api/cron/ad-winners
 *
 * Refreshes the `wonderly_winners` Google Sheet with Meta ad-level "winners": ads that
 * clear a Results (lead volume) floor at or under a CPL (cost-per-result) cap, across four
 * rolling windows — Last 7 Days, Last 14 Days, Last 30 Days, and All Time. Runs weekly via
 * Vercel cron (see vercel.json).
 *
 * Started as a sheet Emily rebuilt by hand from Ads Manager every week; this cron keeps it
 * current going forward — same columns, same per-window thresholds, same Ads Manager link
 * on every ad name. See `src/lib/ad-winners.ts` for the windows/thresholds and CLAUDE.md's
 * "Ad Winners Sheet" section for the full model (including two inferred rules worth
 * double-checking with Emily: the "Near" cutoff and the All Time trial/registration split).
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import {
  AD_WINNER_WINDOWS,
  AD_WINNERS_HEADERS,
  buildAdWinnersFormatRequests,
  computeAdWinnerRows,
  toAdWinnerValues,
} from '@/lib/ad-winners';
import { WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID } from '@/lib/growth-config';
import { GoogleSheetsService } from '@/services/google-sheets';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';

const logger = createLogger('AdWinnersCron');

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

  const sheetId = process.env.AD_WINNERS_SHEET_ID;

  if (!sheetId) {
    return NextResponse.json({ error: 'AD_WINNERS_SHEET_ID is not configured' }, { status: 503 });
  }

  const meta = new MetaService(process.env.META_SYSTEM_ACCESS_TOKEN ?? '', WONDERLY_AD_ACCOUNT_ID);
  const sheets = GoogleSheetsService.fromEnv();

  try {
    // Shared across every window: which action type counts as a "Result" per ad set (for
    // Results/CPL), the raw pixel event per ad set (trial vs registration, for the All Time
    // exclusion), and each ad's current effective_status (so paused/campaign-paused/
    // adset-paused ads still show up instead of silently dropping off the report).
    const [optimizationMap, eventTypeMap, statusMap] = await Promise.all([
      meta.getOptimizationMap(),
      meta.getAdSetEventTypeMap(),
      meta.getAdEffectiveStatusMap(),
    ]);

    const windowCounts: Record<string, number> = {};

    for (const window of AD_WINNER_WINDOWS) {
      // NOTE: getAdLevelInsights caps at 200 ads per call (no pagination). Fine for the
      // 7/14/30-day windows; if the account's lifetime ad count ever exceeds 200, the "All
      // Time" tab needs the same after/paging.next cursor loop as getAdEffectiveStatusMap.
      const insights = await meta.getAdLevelInsights(window.datePreset);
      const winnerRows = computeAdWinnerRows(
        insights.data,
        statusMap,
        optimizationMap,
        eventTypeMap,
        WONDERLY_AD_ACCOUNT_ID,
        WONDERLY_BUSINESS_ID,
        window
      );

      await sheets.ensureTab(sheetId, window.tabName);
      await sheets.replaceRows(
        sheetId,
        window.tabName,
        [...AD_WINNERS_HEADERS],
        toAdWinnerValues(winnerRows)
      );

      try {
        // +1 for the TOTAL row toAdWinnerValues appends.
        await sheets.formatTab(sheetId, window.tabName, (gid) =>
          buildAdWinnersFormatRequests(gid, winnerRows.length + 1)
        );
      } catch (formatError) {
        logger.error(`${window.tabName} formatting failed (values still written)`, formatError);
      }

      windowCounts[window.tabName] = winnerRows.length;
    }

    logger.info('Ad winners sheet refreshed', windowCounts);

    return NextResponse.json({ ok: true, windows: windowCounts });
  } catch (error) {
    logger.error('Ad winners refresh failed', error);

    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}
