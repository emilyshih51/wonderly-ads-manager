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
