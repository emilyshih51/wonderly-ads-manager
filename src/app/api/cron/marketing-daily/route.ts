/**
 * GET /api/cron/marketing-daily
 *
 * Refreshes the Marketing Performance sheet's raw (Blended) tab. Runs every 3 hours
 * via Vercel cron (see vercel.json).
 *
 * Pulls Meta spend from the Meta API and the funnel/booking/sales counts from
 * Snowflake, joins them on date, and writes every tab: the raw `wonderly_daily`, the
 * Daily Funnel, customer P&L, the deal-level Call 1 tab + summary, the `meta` freshness
 * stamp, and the Overview KPI dashboard (freshness, cost-per, warnings, week-over-week).
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import {
  CALL1_DEALS_HEADERS,
  CALL1_SUMMARY_HEADERS,
  computeCall1Summary,
  toCall1DealsValues,
} from '@/lib/call1-deals';
import { DAILY_FUNNEL_HEADERS, toDailyFunnelValues } from '@/lib/daily-funnel';
import { DEFINITIONS_HEADERS, toDefinitionsValues } from '@/lib/definitions';
import { computeOverview } from '@/lib/overview';
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

/** Daily Funnel tab: per-step count, conversion rate, and cost, one row per day. */
const DAILY_FUNNEL_TAB = 'Daily Funnel';

/** Overview: the KPI dashboard — freshness, cost-per, warnings, and week-over-week. */
const OVERVIEW_TAB = 'Overview';

/** Definitions: glossary of every field (meaning, source, counting rule). */
const DEFINITIONS_TAB = 'Definitions';

/** Freshness/health tab. Other tabs reference it, and it never gets cleared with the data. */
const META_TAB = 'meta';

/** Customer P&L tab (Wonderly's servicing economics), written by the same cron. */
const CUSTOMER_PNL_TAB = 'customer_pnl';

/** Customer P&L is a cheap aggregate view — pull a longer window for the trend. */
const CUSTOMER_PNL_DAYS = 90;

/** Deal-level Call 1 fact table (audit trail behind the acceptance rates). */
const CALL1_DEALS_TAB = 'call1_deals';

/**
 * Cohort window for the deal-level tab. Recent Call 1s keep maturing (held → accepted)
 * for weeks, so we re-derive a 90-day window each run and let those flags fill in.
 */
const CALL1_DEALS_DAYS = 90;

/** Headline Call 1 economics tab (cost per Call 1, held rate, accepted CAC). */
const CALL1_SUMMARY_TAB = 'call1_summary';

/**
 * Cohort window for the summary. 30 days keeps it aligned with the FB spend the cron
 * pulls (REFETCH_DAYS), so cost-per figures share a numerator/denominator window.
 */
const CALL1_SUMMARY_DAYS = 30;

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

    // Daily Funnel: per-step count / conversion / cost, derived from the same rows.
    await sheets.ensureTab(sheetId, DAILY_FUNNEL_TAB);
    await sheets.replaceRows(
      sheetId,
      DAILY_FUNNEL_TAB,
      [...DAILY_FUNNEL_HEADERS],
      toDailyFunnelValues(merged)
    );

    // Customer P&L: a self-contained daily aggregate from the customer-value view.
    // Full-window rewrite each run, so no read-back/merge needed.
    const customerPnl = await snow.getDailyCustomerPnl(CUSTOMER_PNL_DAYS);

    await sheets.replaceRows(
      sheetId,
      CUSTOMER_PNL_TAB,
      [...CUSTOMER_PNL_HEADERS],
      toCustomerPnlValues(customerPnl)
    );

    // Deal-level Call 1 fact table: one row per booked deal, re-derived each run so
    // recent cohorts keep maturing. Full-window rewrite, no read-back/merge needed.
    const call1Deals = await snow.getCall1Deals(CALL1_DEALS_DAYS);

    await sheets.ensureTab(sheetId, CALL1_DEALS_TAB);
    await sheets.replaceRows(
      sheetId,
      CALL1_DEALS_TAB,
      [...CALL1_DEALS_HEADERS],
      toCall1DealsValues(call1Deals)
    );

    // Headline economics derived from the same deals + FB spend, over a 30-day window.
    await sheets.ensureTab(sheetId, CALL1_SUMMARY_TAB);
    await sheets.replaceRows(
      sheetId,
      CALL1_SUMMARY_TAB,
      [...CALL1_SUMMARY_HEADERS],
      computeCall1Summary(call1Deals, merged, CALL1_SUMMARY_DAYS, today)
    );

    // Freshness stamp on its own tab (never cleared with the data tabs).
    const refreshedPt = new Date().toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    await sheets.ensureTab(sheetId, META_TAB);
    await sheets.replaceRows(
      sheetId,
      META_TAB,
      ['METRIC', 'VALUE'],
      [
        ['LAST_REFRESHED_PT', refreshedPt],
        ['NEWEST_DATE', merged[0]?.date ?? ''],
        ['DAILY_ROWS', merged.length],
        ['CALL1_DEALS_ROWS', call1Deals.length],
      ]
    );

    // Overview KPI dashboard: freshness, cost-per, warnings, and week-over-week.
    const ptToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const overview = computeOverview({
      rows: merged,
      call1Deals,
      lastRefreshedPt: refreshedPt,
      today: ptToday,
    });

    await sheets.ensureTab(sheetId, OVERVIEW_TAB);
    await sheets.replaceRows(sheetId, OVERVIEW_TAB, overview[0].map(String), overview.slice(1));

    // Definitions: static glossary of every field (meaning, source, rule).
    await sheets.ensureTab(sheetId, DEFINITIONS_TAB);
    await sheets.replaceRows(
      sheetId,
      DEFINITIONS_TAB,
      [...DEFINITIONS_HEADERS],
      toDefinitionsValues()
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
      call1Deals: call1Deals.length,
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
      accepted: num(row[11]),
      noShow: num(row[12]),
      disqualifiedLost: num(row[13]),
      held: num(row[14]),
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
