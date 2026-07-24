/**
 * GET /api/cron/marketing-daily
 *
 * Refreshes the Marketing Performance sheet's raw (Blended) tab. Runs every 3 hours
 * via Vercel cron (see vercel.json).
 *
 * Pulls Meta spend from the Meta API and the funnel/booking/sales counts from
 * Snowflake, joins them on date, and overwrites the tab. The Overview tab's formulas
 * do the rest — this endpoint writes raw counts only, computes no ratios.
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import { CUSTOMER_PNL_HEADERS, toCustomerPnlValues } from '@/lib/customer-pnl';
import {
  joinMarketingDaily,
  mergeRows,
  toSheetValues,
  checkStaleness,
  RAW_TAB_HEADERS,
  type MarketingDailyRow,
} from '@/lib/marketing-daily';
import { GoogleSheetsService } from '@/services/google-sheets';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';
import { SnowflakeService } from '@/services/snowflake';

const logger = createLogger('MarketingDailyCron');

/** Wonderly's own ad account. Not the client accounts — their spend is not our CAC. */
const WONDERLY_AD_ACCOUNT_ID = '1403742814420018';

const RAW_TAB_NAME = 'wonderly_daily';

/** Customer P&L tab (Wonderly's servicing economics), written by the same cron. */
const CUSTOMER_PNL_TAB = 'customer_pnl';

/** Customer P&L is a cheap aggregate view — pull a longer window for the trend. */
const CUSTOMER_PNL_DAYS = 90;

/**
 * How many trailing days to re-pull from source each run.
 *
 * Meta only needs ~2 days (it restates spend for 24–48h), but a wider window means
 * the whole visible sheet is always sourced fresh rather than relying on reading old
 * rows back — so a formatting/parse hiccup can't leave stale or zeroed rows.
 */
const REFETCH_DAYS = 35;

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

  const snow = SnowflakeService.fromEnv();

  try {
    const today = isoDate(new Date());
    const since = isoDate(daysAgo(REFETCH_DAYS - 1));

    const meta = new MetaService(
      process.env.META_SYSTEM_ACCESS_TOKEN ?? '',
      WONDERLY_AD_ACCOUNT_ID
    );
    const sheets = GoogleSheetsService.fromEnv();

    // Meta answers the money question; Snowflake answers the funnel + sales question.
    // Neither knows the other — that is why there are two reads and one join on date.
    const [spend, marketing] = await Promise.all([
      meta.getDailySpendForDateRange(since, today),
      snow.getDailyMarketing(REFETCH_DAYS),
    ]);

    const fresh = joinMarketingDaily(spend, marketing);
    const existing = parseExistingRows(await sheets.readRows(sheetId, RAW_TAB_NAME));
    const merged = mergeRows(existing, fresh);

    await sheets.replaceRows(sheetId, RAW_TAB_NAME, [...RAW_TAB_HEADERS], toSheetValues(merged));

    // Customer P&L: a self-contained daily aggregate from the customer-value view.
    // Full-window rewrite each run, so no read-back/merge needed.
    const customerPnl = await snow.getDailyCustomerPnl(CUSTOMER_PNL_DAYS);

    await sheets.replaceRows(
      sheetId,
      CUSTOMER_PNL_TAB,
      [...CUSTOMER_PNL_HEADERS],
      toCustomerPnlValues(customerPnl)
    );

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
  } finally {
    await snow.close();
  }
}

/**
 * Post a failure or staleness warning to Slack.
 *
 * Swallows its own errors: a broken alert must not mask the problem it is reporting.
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
 * Parse the raw tab's existing cells back into typed rows, in RAW_TAB_HEADERS order.
 *
 * Older rows outside the refetch window are preserved this way rather than refetched.
 *
 * @param values - Raw cell matrix from the sheet, header row first
 */
function parseExistingRows(values: (string | number)[][]): MarketingDailyRow[] {
  return values
    .slice(1)
    .filter((row) => String(row[0] ?? '').match(/^\d{4}-\d{2}-\d{2}$/))
    .map((row) => ({
      date: String(row[0]),
      fbSpend: num(row[1]),
      fbImpressions: num(row[2]),
      fbClicks: num(row[3]),
      pageView: num(row[4]),
      ctaClicked: num(row[5]),
      submitPartial: num(row[6]),
      submitQualified: num(row[7]),
      bookedAll: num(row[8]),
      bookedFb: num(row[9]),
      bookedOrganic: num(row[10]),
      call1Booked: num(row[11]),
      accepted: num(row[12]),
      noShow: num(row[13]),
    }));
}

function num(value: string | number | undefined): number {
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
