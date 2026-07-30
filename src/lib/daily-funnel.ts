/**
 * Daily Funnel — one row per day showing every step of the "Finding Matt" funnel,
 * with the count, the step-to-step conversion rate, and the cost per result.
 *
 * Computed in code (not sheet formulas) so the logic is version-controlled and unit
 * tested, and so the tab can't silently read the wrong column when `wonderly_daily`
 * changes shape. Each field is pulled from `MarketingDailyRow` by name, and rates /
 * costs are derived here. The cron writes the result to the `daily_funnel` tab.
 *
 * Funnel: FB spend → visits → CTA → partial form → qualified form → Call 1 booked
 * (the BOOKING_COMPLETE count) → held → accepted. Held and accepted are cohort metrics —
 * of that day's Call 1 bookings, how many eventually held / were accepted — and convert
 * against the Call 1 booked count, so recent days read low until the cohort matures.
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';

/** Column order for the Daily Funnel tab: count, conversion, cost per step. */
export const DAILY_FUNNEL_HEADERS = [
  'DATE',
  'FB_SPEND',
  'VISITS',
  'COST_PER_VISIT',
  'CTA',
  'CTA_RATE',
  'COST_PER_CTA',
  'PARTIAL',
  'PARTIAL_RATE',
  'COST_PER_PARTIAL',
  'QUALIFIED',
  'QUAL_RATE',
  'COST_PER_QUAL',
  'CALL1_BOOKED',
  'CALL1_RATE',
  'COST_PER_CALL1',
  'HELD',
  'HELD_RATE',
  'COST_PER_HELD',
  'ACCEPTED',
  'ACCEPT_RATE',
  'COST_PER_ACCEPTED',
] as const;

/** Conversion ratio, div-by-zero safe, 4 dp (stored as a fraction; format the cell as %). */
function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

/** Cost per result: FB spend ÷ count, div-by-zero safe, rounded to cents. */
function cost(spend: number, count: number): number {
  return count > 0 ? Math.round((spend / count) * 100) / 100 : 0;
}

/** Round to cents. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build the daily funnel matrix in DAILY_FUNNEL_HEADERS order.
 *
 * Each step's conversion is measured against the previous step; `held_rate` and
 * `accept_rate` are against the Call 1 booked count (`BOOKED_ALL`), matching how the
 * outcome rates are defined on the Overview. Cost per result is FB spend ÷ that step.
 *
 * @param rows - Joined daily rows, newest first
 */
export function toDailyFunnelValues(rows: MarketingDailyRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.date,
    money(r.fbSpend),
    r.pageView,
    cost(r.fbSpend, r.pageView),
    r.ctaClicked,
    rate(r.ctaClicked, r.pageView),
    cost(r.fbSpend, r.ctaClicked),
    r.submitPartial,
    rate(r.submitPartial, r.ctaClicked),
    cost(r.fbSpend, r.submitPartial),
    r.submitQualified,
    rate(r.submitQualified, r.submitPartial),
    cost(r.fbSpend, r.submitQualified),
    r.bookedAll,
    rate(r.bookedAll, r.submitQualified),
    cost(r.fbSpend, r.bookedAll),
    r.held,
    rate(r.held, r.bookedAll),
    cost(r.fbSpend, r.held),
    r.accepted,
    rate(r.accepted, r.bookedAll),
    cost(r.fbSpend, r.accepted),
  ]);
}
