/**
 * Pure functions for building the marketing performance sheet's raw (Blended) tab.
 *
 * Two sources, one join. Meta knows what we spent; Snowflake (Amplitude + the
 * WONDERLY_SALES pipeline) knows the funnel, the bookings by source, and the sales
 * stages. Neither knows the other — these functions put both in the same row
 * because they share a date.
 *
 * Deliberately free of I/O so the join can be unit tested without hitting Snowflake
 * or Meta. All ratios (CPC, conversion %, acceptance rate, w/w) are left to the
 * sheet's formulas — the cron writes only raw counts, so a wrong number is always
 * traceable to either the query or the formula, never both.
 */

/** Daily spend as reported by the Meta Marketing API, one entry per day. */
export interface MetaDailySpend {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * One aggregated day of funnel + booking-by-source + sales-stage counts from
 * Snowflake. Counts are unique people per stage (bookings) / events (sales stages).
 */
export interface DailyMarketingRow {
  date: string;
  pageView: number;
  /** Page views whose session carried a Facebook signal (utm facebook/ig or fbclid). */
  pageViewFb: number;
  pageViewOrganic: number;
  ctaClicked: number;
  ctaFb: number;
  ctaOrganic: number;
  submitPartial: number;
  submitPartialFb: number;
  submitPartialOrganic: number;
  submitQualified: number;
  submitQualifiedFb: number;
  submitQualifiedOrganic: number;
  /** BOOKING_COMPLETE count. The single booking number; rates divide by this. */
  bookedAll: number;
  bookedFb: number;
  bookedOrganic: number;
  /** Sales-pipeline cohort: of that day's booked deals, how many ever reached "Accepted". */
  accepted: number;
  /** Accepted deals attributed to Facebook (via the deal's Call 1 source). */
  acceptedFb: number;
  /** Accepted deals not attributed to Facebook (= accepted − acceptedFb). */
  acceptedOrganic: number;
  /**
   * Sales-pipeline cohort: how many of that day's booked deals are currently a no-show
   * (CRM stage "Call Missed Several Times").
   */
  noShow: number;
  /** No-show deals attributed to Facebook (via the deal's Call 1 source). */
  noShowFb: number;
  /** No-show deals not attributed to Facebook (= noShow − noShowFb). */
  noShowOrganic: number;
  /** Sales-pipeline cohort: how many of that day's booked deals are currently "Disqualified or Lost". */
  disqualifiedLost: number;
  /** Sales-pipeline cohort: how many of that day's booked deals were held (the call happened). */
  held: number;
  /** Held deals attributed to Facebook (via the deal's Call 1 source). */
  heldFb: number;
  /** Held deals not attributed to Facebook (= held − heldFb). */
  heldOrganic: number;
}

/**
 * Header row for the Blended tab. Column order here is the contract the Overview
 * formulas reference by position, so do not reorder without updating the sheet.
 */
export const RAW_TAB_HEADERS = [
  'DATE',
  'FB_SPEND',
  'FB_IMPRESSIONS',
  'FB_CLICKS',
  'PAGE_VIEW',
  'PAGE_VIEW_FB',
  'PAGE_VIEW_ORGANIC',
  'CTA_CLICKED',
  'CTA_FB',
  'CTA_ORGANIC',
  'SUBMIT_PARTIAL',
  'PARTIAL_FB',
  'PARTIAL_ORGANIC',
  'SUBMIT_QUALIFIED',
  'QUALIFIED_FB',
  'QUALIFIED_ORGANIC',
  'BOOKED_ALL',
  'BOOKED_FB',
  'BOOKED_ORGANIC',
  'ACCEPTED',
  'ACCEPTED_FB',
  'ACCEPTED_ORGANIC',
  'NO_SHOW',
  'DISQUALIFIED_LOST',
  'HELD',
  'HELD_FB',
  'HELD_ORGANIC',
  // Appended after HELD_* (not next to NO_SHOW) so the positional raw-tab reader keeps every
  // existing column index; older rows without these cells just read 0 until refetched.
  'NO_SHOW_FB',
  'NO_SHOW_ORGANIC',
] as const;

/** One fully joined day, ready to write to the Blended tab. */
export interface MarketingDailyRow extends DailyMarketingRow {
  fbSpend: number;
  fbImpressions: number;
  fbClicks: number;
}

/**
 * Join Meta spend to the Snowflake funnel on date.
 *
 * A date appearing in either source produces a row — spend with no funnel is a real
 * (dead) day, and funnel with no spend is organic traffic. Dropping either would
 * quietly flatter the numbers.
 *
 * @param spend - Daily spend rows from the Meta API
 * @param marketing - Daily funnel/booking/sales rows from Snowflake
 * @returns Joined rows sorted newest first, matching the sheet's row order
 */
export function joinMarketingDaily(
  spend: MetaDailySpend[],
  marketing: DailyMarketingRow[]
): MarketingDailyRow[] {
  const spendByDate = new Map(spend.map((s) => [s.date, s]));
  const marketingByDate = new Map(marketing.map((m) => [m.date, m]));
  const dates = new Set([...spendByDate.keys(), ...marketingByDate.keys()]);

  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const s = spendByDate.get(date);
      const m = marketingByDate.get(date);

      return {
        date,
        fbSpend: round2(s?.spend ?? 0),
        fbImpressions: s?.impressions ?? 0,
        fbClicks: s?.clicks ?? 0,
        pageView: m?.pageView ?? 0,
        pageViewFb: m?.pageViewFb ?? 0,
        pageViewOrganic: m?.pageViewOrganic ?? 0,
        ctaClicked: m?.ctaClicked ?? 0,
        ctaFb: m?.ctaFb ?? 0,
        ctaOrganic: m?.ctaOrganic ?? 0,
        submitPartial: m?.submitPartial ?? 0,
        submitPartialFb: m?.submitPartialFb ?? 0,
        submitPartialOrganic: m?.submitPartialOrganic ?? 0,
        submitQualified: m?.submitQualified ?? 0,
        submitQualifiedFb: m?.submitQualifiedFb ?? 0,
        submitQualifiedOrganic: m?.submitQualifiedOrganic ?? 0,
        bookedAll: m?.bookedAll ?? 0,
        bookedFb: m?.bookedFb ?? 0,
        bookedOrganic: m?.bookedOrganic ?? 0,
        accepted: m?.accepted ?? 0,
        acceptedFb: m?.acceptedFb ?? 0,
        acceptedOrganic: m?.acceptedOrganic ?? 0,
        noShow: m?.noShow ?? 0,
        noShowFb: m?.noShowFb ?? 0,
        noShowOrganic: m?.noShowOrganic ?? 0,
        disqualifiedLost: m?.disqualifiedLost ?? 0,
        held: m?.held ?? 0,
        heldFb: m?.heldFb ?? 0,
        heldOrganic: m?.heldOrganic ?? 0,
      };
    });
}

/**
 * Convert joined rows to the sheet's cell matrix, in RAW_TAB_HEADERS order.
 *
 * @param rows - Joined daily rows
 */
export function toSheetValues(rows: MarketingDailyRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.date,
    r.fbSpend,
    r.fbImpressions,
    r.fbClicks,
    r.pageView,
    r.pageViewFb,
    r.pageViewOrganic,
    r.ctaClicked,
    r.ctaFb,
    r.ctaOrganic,
    r.submitPartial,
    r.submitPartialFb,
    r.submitPartialOrganic,
    r.submitQualified,
    r.submitQualifiedFb,
    r.submitQualifiedOrganic,
    r.bookedAll,
    r.bookedFb,
    r.bookedOrganic,
    r.accepted,
    r.acceptedFb,
    r.acceptedOrganic,
    r.noShow,
    r.disqualifiedLost,
    r.held,
    r.heldFb,
    r.heldOrganic,
    r.noShowFb,
    r.noShowOrganic,
  ]);
}

/**
 * Merge freshly fetched rows over existing ones, keyed by date.
 *
 * The refetch window covers the whole visible sheet, so fresh rows always win and
 * older dates outside the window are preserved untouched.
 *
 * @param existing - Rows already in the sheet
 * @param fresh - Rows just fetched
 * @returns Merged rows, newest first
 */
export function mergeRows(
  existing: MarketingDailyRow[],
  fresh: MarketingDailyRow[]
): MarketingDailyRow[] {
  const byDate = new Map(existing.map((r) => [r.date, r]));

  for (const row of fresh) byDate.set(row.date, row);

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Check whether the newest row is older than expected, or whether spend has flatlined.
 *
 * This is the check Motion's sheet does not have. Their Facebook connector died and
 * every downstream layer kept reporting success while spend read $0 for months.
 *
 * @param rows - Rows about to be written, newest first
 * @param today - Current date as `YYYY-MM-DD`
 * @param maxAgeDays - Days of lag tolerated before the data is considered stale
 * @returns A human-readable reason when stale, otherwise null
 */
export function checkStaleness(
  rows: MarketingDailyRow[],
  today: string,
  maxAgeDays = 2
): string | null {
  if (rows.length === 0) return 'marketing sheet: no rows returned at all';

  const newest = rows[0].date;
  const ageDays = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000
  );

  if (ageDays > maxAgeDays) {
    return `marketing sheet is stale — newest data is ${newest} (${ageDays} days old)`;
  }

  const recent = rows.slice(0, maxAgeDays + 1);

  if (recent.length > 0 && recent.every((r) => r.fbSpend === 0)) {
    return `marketing sheet: FB_SPEND is $0 across the last ${recent.length} days — Meta side is probably broken, not paused`;
  }

  if (recent.length > 0 && recent.every((r) => r.pageView === 0)) {
    return `marketing sheet: PAGE_VIEW is 0 across the last ${recent.length} days — Snowflake side is probably broken`;
  }

  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
