/**
 * Call 1 deal-level fact table — one row per deal that entered the Call 1 funnel:
 * booked, or (when its "Call 1 Scheduled" event was never captured) ever held / accepted.
 * Those event-less deals have a blank BOOKED_DAY but still count, so ACCEPTED reconciles
 * with Daily Funnel / Daily Metrics.
 *
 * Each row follows a single deal by its permanent `deal_id` from booking through
 * held → accepted. Because the cron re-derives the trailing window every run, a deal's
 * flags update over time as it progresses — a recent deal stays "unfinished" and keeps
 * filling in. This tab is the audit trail behind the aggregate rates.
 *
 * Held and Accepted are milestones (ever-reached) from the stage-change events, so they
 * stay true even after the deal moves on — a held deal later disqualified is both. No-show
 * and disqualified reflect the current CRM stage (those transitions emit no event).
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';

/** One deal's Call 1 journey. */
export interface Call1DealRow {
  dealId: string;
  /** CRM deal name, e.g. "Harrison Wermuth (Dewittbuilding)". Handy for Amplitude lookups. */
  dealName: string;
  /** `YYYY-MM-DD` — day it entered "Call 1 Scheduled". */
  bookedDay: string;
  currentStage: string;
  /** 1 if the Call 1 ever happened — reached a post-call stage (milestone, stays true even if later disqualified). */
  held: number;
  /** 1 if the deal ever reached "Accepted". */
  accepted: number;
  /** 1 if the deal is currently a no-show ("Call Missed Several Times"). */
  noShow: number;
  /** 1 if the deal is currently disqualified/lost (current stage; these don't fire stage events). */
  disqualified: number;
  /** Estimated deal value in USD, 0 when not entered. */
  estAmount: number;
  /** Primary contact's full name, for tracking down the person. */
  contactName: string;
  /** Primary contact's phone. */
  phone: string;
  /** Primary contact's email (Apple relay addresses appear as-is — that's what was submitted). */
  email: string;
  /** Marketing source (e.g. facebook), from the form-submit event's utm_source, joined by email. Blank when unattributed. */
  source: string;
  /** `YYYY-MM-DD` the Call 1 was first held (first post-call event). Blank if held only via current stage or never. */
  heldDate: string;
  /** `YYYY-MM-DD` the deal first reached "Accepted" (the 60/90-day clock start). Blank if never accepted. */
  acceptedDate: string;
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
  'DISQUALIFIED',
  'EST_AMOUNT',
  'CONTACT_NAME',
  'PHONE',
  'EMAIL',
  'SOURCE',
  'HELD_DATE',
  'ACCEPTED_DATE',
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
    r.disqualified,
    r.estAmount,
    r.contactName,
    r.phone,
    r.email,
    r.source,
    r.heldDate,
    r.acceptedDate,
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
 * Roll the deal-level rows + daily marketing/spend into the headline Call 1 economics,
 * over a trailing window (last `windowDays`).
 *
 * Two different Call 1 counts on purpose:
 *  - CALL1_BOOKED (marketing) = the `BOOKING_COMPLETE` event count (matches Amplitude),
 *    and it's the denominator for cost-per-Call 1.
 *  - SALES_CALL1 (pipeline) = deals that entered "Call 1 Scheduled", the denominator for
 *    the held / accepted / no-show rates — because those flags only exist on sales deals.
 * Mixing them (e.g. sales-accepted ÷ marketing-bookings) would produce nonsense rates,
 * so each rate is kept against its own population.
 *
 * Acceptance is flagged "maturing": the newest cohorts haven't finished converting, so it
 * understates the eventual rate — the deal-level tab is where those flags fill in. Cost
 * figures use FB spend as the numerator (organic is ~5% and unattributable per deal, so
 * an FB-only figure is the honest, slightly conservative number). Cost per succeeding
 * customer stays pending until the deal→customer-team link is wired.
 *
 * @param deals - All deal-level rows (sales pipeline)
 * @param marketing - Daily rows carrying FB spend and the BOOKING_COMPLETE count
 * @param windowDays - Trailing window, e.g. 30
 * @param today - `YYYY-MM-DD` of the run
 */
export function computeCall1Summary(
  deals: Call1DealRow[],
  marketing: MarketingDailyRow[],
  windowDays: number,
  today: string
): (string | number)[][] {
  const cutoff = isoDaysBefore(today, windowDays);

  const inWindow = deals.filter((d) => d.bookedDay >= cutoff && d.bookedDay <= today);
  const salesCall1 = inWindow.length;
  const held = inWindow.reduce((sum, d) => sum + d.held, 0);
  const accepted = inWindow.reduce((sum, d) => sum + d.accepted, 0);
  const noShow = inWindow.reduce((sum, d) => sum + d.noShow, 0);
  const acceptedValue = inWindow
    .filter((d) => d.accepted === 1)
    .reduce((sum, d) => sum + d.estAmount, 0);

  const windowRows = marketing.filter((m) => m.date >= cutoff && m.date <= today);
  const marketingBookings = windowRows.reduce((sum, m) => sum + m.bookedAll, 0);
  const fbSpend = windowRows.reduce((sum, m) => sum + m.fbSpend, 0);

  return [
    ['WINDOW', `Last ${windowDays} days (${cutoff} → ${today})`],
    ['CALL1_BOOKED (BOOKING_COMPLETE)', marketingBookings],
    ['FB_SPEND', money(fbSpend)],
    ['COST_PER_CALL1_BOOKED', money(marketingBookings > 0 ? fbSpend / marketingBookings : 0)],
    ['CALL1_SCHEDULED (CRM deals)', salesCall1],
    ['HELD', held],
    ['HELD_RATE', rate(held, salesCall1)],
    ['ACCEPTED (maturing)', accepted],
    ['BOOKED_TO_ACCEPTED_RATE', rate(accepted, salesCall1)],
    ['NO_SHOW', noShow],
    ['NO_SHOW_RATE', rate(noShow, salesCall1)],
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
