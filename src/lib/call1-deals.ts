/**
 * Call 1 deal-level fact table — one row per real Call 1 booked.
 *
 * Each row follows a single deal by its permanent `deal_id` from booking through
 * held → accepted, keyed to the day it entered "Call 1 Scheduled" (its cohort).
 * Because the cron re-derives the trailing window every run, a deal's flags update
 * over time as it progresses — a recent cohort stays "unfinished" and keeps filling
 * in for ~90 days. This tab is the audit trail behind the aggregate rates.
 *
 * Held = the call happened: any stage past "Call 1 Scheduled" except the no-show
 * stage. Accepted = the deal EVER reached "Accepted" (milestone, from the event).
 */

import type { MetaDailySpend } from '@/lib/marketing-daily';

/** One deal's Call 1 journey. */
export interface Call1DealRow {
  dealId: string;
  /** CRM deal name, e.g. "Harrison Wermuth (Dewittbuilding)". Handy for Amplitude lookups. */
  dealName: string;
  /** `YYYY-MM-DD` — day it entered "Call 1 Scheduled". */
  bookedDay: string;
  currentStage: string;
  /** 1 if the call was held (advanced past scheduling, not a no-show). */
  held: number;
  /** 1 if the deal ever reached "Accepted". */
  accepted: number;
  /** 1 if the deal is currently a no-show ("Call Missed Several Times"). */
  noShow: number;
  /** Estimated deal value in USD, 0 when not entered. */
  estAmount: number;
  /** Primary contact's full name, for tracking down the person. */
  contactName: string;
  /** Primary contact's phone. */
  phone: string;
  /** Primary contact's email (Apple relay addresses appear as-is — that's what was submitted). */
  email: string;
}

/** Header row for the call1_deals tab. */
export const CALL1_DEALS_HEADERS = [
  'DEAL_ID',
  'DEAL_NAME',
  'BOOKED_DAY',
  'CURRENT_STAGE',
  'HELD',
  'ACCEPTED',
  'NO_SHOW',
  'EST_AMOUNT',
  'CONTACT_NAME',
  'PHONE',
  'EMAIL',
] as const;

/**
 * Convert deal rows to the sheet's cell matrix, in header order.
 *
 * @param rows - Deal-level rows
 */
export function toCall1DealsValues(rows: Call1DealRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.dealId,
    r.dealName,
    r.bookedDay,
    r.currentStage,
    r.held,
    r.accepted,
    r.noShow,
    r.estAmount,
    r.contactName,
    r.phone,
    r.email,
  ]);
}

/** Header row for the call1_summary tab (a simple metric/value list). */
export const CALL1_SUMMARY_HEADERS = ['METRIC', 'VALUE'] as const;

/** Div-by-zero-safe ratio, rounded to 4 dp. */
function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

/** Round to cents. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Roll the deal-level rows + FB spend into the headline Call 1 economics.
 *
 * Computed over a trailing cohort window (deals booked in the last `windowDays`)
 * so cost-per figures line up with the FB spend from the same days. Acceptance is
 * reported over the same window but flagged "maturing": the newest cohorts haven't
 * finished converting, so this understates the eventual accepted rate — the
 * deal-level tab is where you watch those flags fill in.
 *
 * Cost figures use FB spend as the numerator (organic bookings are ~5% and can't be
 * attributed to a specific deal, so an FB-only CAC is the honest, slightly
 * conservative number). Cost per succeeding customer is left pending — it needs a
 * signed-deal → provisioned-customer link into the customer-value view that isn't
 * established yet.
 *
 * @param deals - All deal-level rows
 * @param spend - Daily FB spend (from the Meta API)
 * @param windowDays - Trailing cohort window, e.g. 30
 * @param today - `YYYY-MM-DD` of the run
 */
export function computeCall1Summary(
  deals: Call1DealRow[],
  spend: MetaDailySpend[],
  windowDays: number,
  today: string
): (string | number)[][] {
  const cutoff = isoDaysBefore(today, windowDays);

  const inWindow = deals.filter((d) => d.bookedDay >= cutoff && d.bookedDay <= today);
  const call1 = inWindow.length;
  const held = inWindow.reduce((sum, d) => sum + d.held, 0);
  const accepted = inWindow.reduce((sum, d) => sum + d.accepted, 0);
  const noShow = inWindow.reduce((sum, d) => sum + d.noShow, 0);
  const acceptedValue = inWindow
    .filter((d) => d.accepted === 1)
    .reduce((sum, d) => sum + d.estAmount, 0);

  const fbSpend = spend
    .filter((s) => s.date >= cutoff && s.date <= today)
    .reduce((sum, s) => sum + s.spend, 0);

  return [
    ['WINDOW', `Last ${windowDays} days booked (${cutoff} → ${today})`],
    ['REAL_CALL1_BOOKED', call1],
    ['HELD', held],
    ['HELD_RATE', rate(held, call1)],
    ['ACCEPTED (still maturing)', accepted],
    ['BOOKED_TO_ACCEPTED_RATE', rate(accepted, call1)],
    ['NO_SHOW', noShow],
    ['NO_SHOW_RATE', rate(noShow, call1)],
    ['FB_SPEND', money(fbSpend)],
    ['COST_PER_REAL_CALL1', money(call1 > 0 ? fbSpend / call1 : 0)],
    ['ACCEPTED_CUSTOMER_CAC', money(accepted > 0 ? fbSpend / accepted : 0)],
    ['ACCEPTED_PIPELINE_VALUE', money(acceptedValue)],
    ['COST_PER_SUCCEEDING_CUSTOMER', 'pending deal→customer link'],
  ];
}

/**
 * `YYYY-MM-DD` string `days` before `today` (also a `YYYY-MM-DD` string).
 *
 * @param today - Reference date
 * @param days - Number of days to subtract
 */
function isoDaysBefore(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() - days);

  return date.toISOString().slice(0, 10);
}
