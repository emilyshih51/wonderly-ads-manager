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
import { computeDailyMetrics } from '@/lib/daily-metrics';
import {
  DAILY_METRICS_FORMAT,
  buildDailyMetricsFormatRequests,
  weekBreakRows,
} from '@/lib/daily-metrics-format';
import { DEFINITIONS_HEADERS, toDefinitionsValues } from '@/lib/definitions';
import { computeOverview } from '@/lib/overview';
import { buildOverviewFormatRequests } from '@/lib/overview-format';
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

/** Daily Metrics tab: Motion-style grid — per-metric ALL + week-over-week, with summary. */
const DAILY_METRICS_TAB = 'Daily Metrics';

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

/** Headline Call 1 economics tab (cost per Call 1, held rate, accepted CAC). */
const CALL1_SUMMARY_TAB = 'call1_summary';

/**
 * Cohort window for the summary. 30 days keeps it aligned with the FB spend the cron
 * pulls (REFETCH_DAYS), so cost-per figures share a numerator/denominator window.
 */
const CALL1_SUMMARY_DAYS = 30;

/**
 * Fixed backfill anchor: every data tab is sourced and displayed from this date forward.
 * The refetch window is derived from it each run (today − BACKFILL_START), so the history
 * stays pinned to May 1 2026 (the first week the sales pipeline data exists) rather than a
 * rolling window that would slowly drop early-May days as time passes.
 */
const BACKFILL_START = '2026-05-01';

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
    // Derive the refetch window from the fixed May-1 anchor so it always reaches back to
    // exactly BACKFILL_START, no matter how much time has passed.
    const backfillDays = daysSince(BACKFILL_START, today) + 1;

    const meta = new MetaService(
      process.env.META_SYSTEM_ACCESS_TOKEN ?? '',
      WONDERLY_AD_ACCOUNT_ID
    );
    const sheets = GoogleSheetsService.fromEnv();

    // Meta answers the money question; Snowflake answers the funnel + sales question.
    // Neither knows the other — that is why there are two reads and one join on date.
    const [spend, marketing] = await Promise.all([
      meta.getDailySpendForDateRange(BACKFILL_START, today),
      snow.getDailyMarketing(backfillDays),
    ]);

    const fresh = joinMarketingDaily(spend, marketing);
    const existing = parseExistingRows(await sheets.readRows(sheetId, RAW_TAB_NAME));
    // Floor at the anchor so any older rows lingering in the sheet drop off the raw tab
    // (and therefore Daily Funnel / Daily Metrics, which derive from these rows).
    const merged = mergeRows(existing, fresh).filter((r) => r.date >= BACKFILL_START);

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

    // Deal-level Call 1 fact table: one row per deal booked since the anchor, re-derived
    // each run (so the current stage / held / accepted flags stay up to date) and floored
    // at May 1. Full-window rewrite, no read-back/merge needed.
    const call1Deals = (await snow.getCall1Deals(backfillDays)).filter(
      (d) => d.bookedDay >= BACKFILL_START
    );

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
    // Succeeding-contractor cohorts come straight from prod (team dim ↔ value view).
    const succeeding = await snow.getSucceedingContractors();
    const ptToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const overview = computeOverview({
      rows: merged,
      call1Deals,
      succeeding,
      lastRefreshedPt: refreshedPt,
      today: ptToday,
    });

    await sheets.ensureTab(sheetId, OVERVIEW_TAB);
    await sheets.replaceRows(sheetId, OVERVIEW_TAB, overview[0].map(String), overview.slice(1));

    // Format the Overview (idempotent, wrapped so it can't fail the data refresh).
    try {
      await sheets.formatTab(sheetId, OVERVIEW_TAB, (gid) =>
        buildOverviewFormatRequests(gid, overview)
      );
    } catch (formatError) {
      logger.error('Overview formatting failed (values still written)', formatError);
    }

    // Definitions: static glossary of every field (meaning, source, rule).
    await sheets.ensureTab(sheetId, DEFINITIONS_TAB);
    await sheets.replaceRows(
      sheetId,
      DEFINITIONS_TAB,
      [...DEFINITIONS_HEADERS],
      toDefinitionsValues()
    );

    // Daily Metrics: Motion-style per-metric grid with week-over-week and a summary block.
    const dailyMetrics = computeDailyMetrics(merged, ptToday);

    await sheets.ensureTab(sheetId, DAILY_METRICS_TAB);
    await sheets.replaceRows(
      sheetId,
      DAILY_METRICS_TAB,
      dailyMetrics[0].map(String),
      dailyMetrics.slice(1)
    );

    // Formatting is orthogonal to values (merges, freeze, number formats, heat-map), so
    // re-applying it each run is idempotent and keeps the layout in sync with the columns.
    // Wrapped so a formatting hiccup can never fail the data refresh.
    try {
      // Daily rows start at sheet row 6 (0-based row 5), newest first.
      const weekBreaks = weekBreakRows(
        merged.map((r) => r.date),
        5
      );

      await sheets.formatTab(sheetId, DAILY_METRICS_TAB, (gid) =>
        buildDailyMetricsFormatRequests(gid, DAILY_METRICS_FORMAT, weekBreaks)
      );
    } catch (formatError) {
      logger.error('Daily Metrics formatting failed (values still written)', formatError);
    }

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
      pageViewFb: num(row[5]),
      pageViewOrganic: num(row[6]),
      ctaClicked: num(row[7]),
      ctaFb: num(row[8]),
      ctaOrganic: num(row[9]),
      submitPartial: num(row[10]),
      submitPartialFb: num(row[11]),
      submitPartialOrganic: num(row[12]),
      submitQualified: num(row[13]),
      submitQualifiedFb: num(row[14]),
      submitQualifiedOrganic: num(row[15]),
      bookedAll: num(row[16]),
      bookedFb: num(row[17]),
      bookedOrganic: num(row[18]),
      accepted: num(row[19]),
      acceptedFb: num(row[20]),
      acceptedOrganic: num(row[21]),
      noShow: num(row[22]),
      disqualifiedLost: num(row[23]),
      held: num(row[24]),
      heldFb: num(row[25]),
      heldOrganic: num(row[26]),
    }));
}

function num(value: string | number | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Whole days from an anchor date up to `today` (both `YYYY-MM-DD`, UTC).
 *
 * @param startIso - The anchor date (e.g. the backfill start)
 * @param today - Today's date
 * @returns The number of days between them
 */
function daysSince(startIso: string, today: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);

  return Math.round((end - start) / 86_400_000);
}
