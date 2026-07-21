/**
 * GET /api/cron/marketing-daily
 *
 * Refreshes the Marketing Performance sheet's raw tab. Runs every 3 hours via
 * Vercel cron (see vercel.json).
 *
 * Pulls Meta spend and Amplitude bookings for a trailing window, joins them on
 * date, and overwrites the raw tab. The sheet's INDIRECT/MATCH formulas do the
 * rest — this endpoint writes one tab and computes no ratios.
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import {
  joinMarketingDaily,
  mergeRows,
  toSheetValues,
  checkStaleness,
  RAW_TAB_HEADERS,
  type MarketingDailyRow,
} from '@/lib/marketing-daily';
import { AmplitudeService } from '@/services/amplitude';
import { GoogleSheetsService } from '@/services/google-sheets';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';

const logger = createLogger('MarketingDailyCron');

/** Wonderly's own ad account. Not the client accounts — their spend is not our CAC. */
const WONDERLY_AD_ACCOUNT_ID = '1403742814420018';

const BOOKED_EVENT = 'MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE';
const QUALIFIED_EVENT = 'MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED';

const RAW_TAB_NAME = 'wonderly_daily';

/** Meta restates spend for 24–48h, so refetch a window rather than appending one day. */
const REFETCH_DAYS = 7;

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

  const sheetId = process.env.MARKETING_SHEET_ID;

  if (!sheetId) {
    return NextResponse.json({ error: 'MARKETING_SHEET_ID is not configured' }, { status: 503 });
  }

  try {
    const today = isoDate(new Date());
    const since = isoDate(daysAgo(REFETCH_DAYS - 1));

    const meta = new MetaService(
      process.env.META_SYSTEM_ACCESS_TOKEN ?? '',
      WONDERLY_AD_ACCOUNT_ID
    );
    const amplitude = new AmplitudeService(
      process.env.AMPLITUDE_API_KEY ?? '',
      process.env.AMPLITUDE_SECRET_KEY ?? ''
    );
    const sheets = GoogleSheetsService.fromEnv();

    // Meta answers the money question; Amplitude answers the meetings question.
    // Neither can answer both — that is why there are two calls and one join.
    const [spend, qualified, booked] = await Promise.all([
      meta.getDailySpendForDateRange(since, today),
      amplitude.getDailyEventCountsBySource(QUALIFIED_EVENT, since, today),
      amplitude.getDailyEventCountsBySource(BOOKED_EVENT, since, today),
    ]);

    const fresh = joinMarketingDaily(spend, qualified, booked);
    const existing = parseExistingRows(await sheets.readRows(sheetId, RAW_TAB_NAME));
    const merged = mergeRows(existing, fresh);

    await sheets.replaceRows(sheetId, RAW_TAB_NAME, [...RAW_TAB_HEADERS], toSheetValues(merged));

    const staleReason = checkStaleness(merged, today);

    if (staleReason) {
      logger.error('Marketing data looks wrong', { reason: staleReason });
      await notifySlack(staleReason);
    }

    logger.info('Marketing sheet refreshed', {
      freshDays: fresh.length,
      totalRows: merged.length,
      newestDate: merged[0]?.date,
    });

    return NextResponse.json({
      ok: true,
      refreshed: fresh.length,
      totalRows: merged.length,
      newestDate: merged[0]?.date ?? null,
      stale: staleReason,
    });
  } catch (error) {
    logger.error('Marketing sheet refresh failed', error);
    await notifySlack(
      `marketing sheet refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );

    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}

/**
 * Post a failure or staleness warning to Slack.
 *
 * Swallows its own errors: a broken alert must not mask the problem it is trying
 * to report, and the cron result matters more than the notification.
 *
 * @param message - Human-readable description of what went wrong
 */
async function notifySlack(message: string): Promise<void> {
  const channel = process.env.MARKETING_ALERT_SLACK_CHANNEL_ID;

  if (!channel) return;

  try {
    const slack = new SlackService(
      process.env.SLACK_BOT_TOKEN ?? '',
      process.env.SLACK_SIGNING_SECRET ?? ''
    );

    await slack.postMessage(channel, `⚠️ ${message}`);
  } catch (error) {
    logger.error('Failed to post marketing alert to Slack', error);
  }
}

/**
 * Parse the raw tab's existing cells back into typed rows.
 *
 * Skips the header row and any row without a date. Older rows outside the refetch
 * window are preserved this way rather than being refetched every run.
 *
 * @param values - Raw cell matrix from the sheet, header row first
 */
function parseExistingRows(values: string[][]): MarketingDailyRow[] {
  return values
    .slice(1)
    .filter((row) => row[0]?.match(/^\d{4}-\d{2}-\d{2}$/))
    .map((row) => ({
      date: row[0],
      fbSpend: num(row[1]),
      fbImpressions: num(row[2]),
      fbClicks: num(row[3]),
      fbQualified: num(row[4]),
      fbBooked: num(row[5]),
      otherQualified: num(row[6]),
      otherBooked: num(row[7]),
    }));
}

function num(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): Date {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - days);

  return date;
}
