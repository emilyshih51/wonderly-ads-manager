/**
 * Overview — the KPI dashboard the Growth Sheet spec asks for.
 *
 * Assembled in code (name-based, unit-tested) rather than sheet formulas, so it can't
 * silently read the wrong column and the warning rules live in one reviewable place.
 * It shows, top to bottom:
 *   - freshness (last refresh + the newest data date)
 *   - headline cost per result over the last 7 days (confirmed Call 1, accepted, and
 *     the two succeeding-contractor rows that stay pending until the deal→customer
 *     link exists)
 *   - warnings with explicit rules (stale data, Call 1 bookings down >15% w/w, and
 *     the source-attribution / connection rate)
 *   - the week-over-week block (this 7 days vs the previous 7), reusing the funnel math
 *
 * The cron writes the result to the "Overview" tab.
 */

import type { Call1DealRow } from '@/lib/call1-deals';
import type { MarketingDailyRow } from '@/lib/marketing-daily';
import { type SucceedingContractors, succeedingCostCell } from '@/lib/succeeding';
import { WEEK_OVER_WEEK_HEADERS, computeWeekOverWeek } from '@/lib/week-over-week';

/** Below this source-attribution rate, warn (spec: >5% of Call 1s unconnected). */
const MIN_CONNECTION_RATE = 0.95;

/** Call 1 bookings falling more than this week-over-week trips a warning. */
const CALL1_DROP_THRESHOLD = -0.15;

function sum(rows: MarketingDailyRow[], f: (r: MarketingDailyRow) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Format a fraction as a signed percent string, e.g. 0.123 → "+12.3%". */
function pctStr(fraction: number): string {
  const sign = fraction > 0 ? '+' : '';

  return `${sign}${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;
}

/**
 * Build the Overview matrix. Rows vary in width (label/value rows plus the w/w table);
 * the sheet leaves trailing cells blank.
 *
 * @param opts.rows - Daily rows, newest first (as written to `wonderly_daily`)
 * @param opts.call1Deals - Deal-level rows, for the source-attribution rate
 * @param opts.lastRefreshedPt - Human-readable last-refresh time (Pacific)
 * @param opts.today - Pacific `YYYY-MM-DD`, for the stale-data check
 */
export function computeOverview(opts: {
  rows: MarketingDailyRow[];
  call1Deals: Call1DealRow[];
  succeeding: SucceedingContractors;
  lastRefreshedPt: string;
  today: string;
}): (string | number)[][] {
  const { rows, call1Deals, succeeding, lastRefreshedPt, today } = opts;

  // Compare the last 7 *completed* days — exclude today's partial row, which otherwise
  // gets weighed against full days and reads artificially low.
  const complete = rows.filter((r) => r.date < today);

  const wk = complete.slice(0, 7);
  const spend7 = sum(wk, (r) => r.fbSpend);
  const call1_7 = sum(wk, (r) => r.bookedAll);
  const accepted7 = sum(wk, (r) => r.accepted);

  const costPerCall1 = call1_7 > 0 ? money(spend7 / call1_7) : 0;
  const costPerAccepted = accepted7 > 0 ? money(spend7 / accepted7) : 0;

  // Cost per succeeding contractor: Facebook acquisition spend over the cohort's
  // acceptance window ÷ how many of that cohort succeed (ROI ≥ 2×). Connects a cohort's
  // spend to that cohort's success rather than dividing all-time spend by everyone.
  const cohortSpend = (start: string, end: string): number =>
    start && end
      ? money(
          sum(
            rows.filter((r) => r.date >= start && r.date <= end),
            (r) => r.fbSpend
          )
        )
      : 0;
  const succeeding60 = succeedingCostCell(
    cohortSpend(succeeding.cohort60Start, succeeding.cohort60End),
    succeeding.succeeding60,
    succeeding.matured60
  );
  const succeeding90 = succeedingCostCell(
    cohortSpend(succeeding.cohort90Start, succeeding.cohort90End),
    succeeding.succeeding90,
    succeeding.matured90
  );

  const newest = rows[0]?.date ?? '';
  const dataStale = newest !== '' && newest < today;

  const wow = computeWeekOverWeek(complete);
  const call1Wow = wow.find((r) => r[0] === 'CALL1_BOOKED');
  const call1Pct = call1Wow ? Number(call1Wow[4]) : 0;
  const call1Drop = call1Pct < CALL1_DROP_THRESHOLD;

  const attributed = call1Deals.filter((d) => d.source !== '').length;
  const connRate = call1Deals.length > 0 ? attributed / call1Deals.length : 1;
  const connLow = connRate < MIN_CONNECTION_RATE;

  const matrix: (string | number)[][] = [
    ['Wonderly Growth — Overview'],
    ['Last refreshed (PT)', lastRefreshedPt],
    ['Data through', newest],
    [],
    ['HEADLINE COST — last 7 days'],
    ['Cost per Call 1 booked', costPerCall1],
    ['Cost per accepted contractor', costPerAccepted],
    ['Cost per succeeding contractor (60d)', succeeding60],
    ['Cost per succeeding contractor (90d)', succeeding90],
    [
      '',
      'Succeeding = P&L > 0 (modeled expected contribution exceeds actual managed Meta spend) within 60/90d of acceptance. Cost = FB spend over the cohort’s acceptance window ÷ succeeding; "maturing" until enough clear the bar.',
    ],
    [],
    ['WARNINGS'],
    [dataStale ? `⚠️ Data is stale — newest is ${newest}` : `✓ Data current through ${newest}`],
    [
      call1Drop
        ? `⚠️ Call 1 bookings ${pctStr(call1Pct)} vs last week (rule: drop >15%)`
        : `✓ Call 1 bookings ${pctStr(call1Pct)} w/w`,
    ],
    [
      connLow
        ? `⚠️ ${((1 - connRate) * 100).toFixed(1)}% of Call 1s have no attributed source (rule: >5% unconnected)`
        : `✓ ${(connRate * 100).toFixed(1)}% of Call 1s attributed to a source`,
    ],
    [],
    ['SEVEN DAYS vs PREVIOUS SEVEN DAYS'],
    [...WEEK_OVER_WEEK_HEADERS],
    ...wow,
  ];

  return matrix;
}
