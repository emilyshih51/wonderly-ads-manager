/**
 * Pure functions for building the marketing performance sheet's raw tab.
 *
 * The sheet is Motion's architecture, stripped to Wonderly's funnel. Meta knows
 * what we spent; Amplitude knows what we got. Neither knows the other. These
 * functions are the join — they put both in the same row because they share a
 * date, which is the only thread connecting a dollar to a booking.
 *
 * Deliberately free of I/O so the join can be unit tested without hitting either
 * API. All ratios (cost per booking, w/w) are left to the sheet's formulas: the
 * cron reports only what each API said, so a wrong number is always traceable to
 * either the API or the formula, never both.
 */

/** A channel bucket in the marketing sheet. Maps one or more utm_source values. */
export type MarketingChannel = 'fb' | 'other';

/**
 * One day of a single event's occurrences, bucketed by utm_source.
 *
 * Source-agnostic on purpose: today these counts come from Snowflake
 * (`AMPLITUDE.AMPLITUDE.EVENTS_766268`), but the join doesn't care whether they
 * came from Snowflake, the Amplitude REST API, or anywhere else.
 */
export interface EventDailyCounts {
  /** `YYYY-MM-DD` */
  date: string;
  /** utm_source value, lowercased, e.g. `facebook`, `(none)`. */
  utmSource: string;
  /** Event occurrences on this date for this source. */
  count: number;
}

/** Header row for the raw tab. The sheet's INDIRECT/MATCH formulas match on these. */
export const RAW_TAB_HEADERS = [
  'DATE',
  'FB_SPEND',
  'FB_IMPRESSIONS',
  'FB_CLICKS',
  'FB_QUALIFIED',
  'FB_BOOKED',
  'OTHER_QUALIFIED',
  'OTHER_BOOKED',
] as const;

/**
 * utm_source → channel bucket.
 *
 * `facebook` and `ig` are both Meta and both billed to the same ad account, so
 * they must fold into one channel or spend will not reconcile against bookings.
 * Everything else (including `(none)`, ~17% of bookings) is unattributed and has
 * no spend — it lands in `other` so the totals still add up.
 */
export const UTM_SOURCE_TO_CHANNEL: Record<string, MarketingChannel> = {
  facebook: 'fb',
  ig: 'fb',
};

/** One fully joined day, ready to write to the sheet. */
export interface MarketingDailyRow {
  date: string;
  fbSpend: number;
  fbImpressions: number;
  fbClicks: number;
  fbQualified: number;
  fbBooked: number;
  otherQualified: number;
  otherBooked: number;
}

/** Daily spend as reported by Meta, one entry per day. */
export interface MetaDailySpend {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Bucket a utm_source into a channel.
 *
 * @param utmSource - Raw value from Amplitude, e.g. `facebook`, `ig`, `(none)`
 * @returns The channel this source belongs to
 */
export function channelForSource(utmSource: string): MarketingChannel {
  return UTM_SOURCE_TO_CHANNEL[utmSource.toLowerCase()] ?? 'other';
}

/**
 * Sum Amplitude counts into `{ [date]: { fb, other } }`.
 *
 * @param counts - Flattened per-date, per-source counts
 */
export function bucketByChannel(
  counts: EventDailyCounts[]
): Record<string, Record<MarketingChannel, number>> {
  const out: Record<string, Record<MarketingChannel, number>> = {};

  for (const { date, utmSource, count } of counts) {
    out[date] ??= { fb: 0, other: 0 };
    out[date][channelForSource(utmSource)] += count;
  }

  return out;
}

/**
 * Join Meta spend to Amplitude outcomes on date.
 *
 * A date appearing in either source produces a row — spend with no bookings is a
 * real (bad) day, and bookings with no spend are the unattributed `(none)` traffic.
 * Dropping either would quietly flatter the numbers.
 *
 * @param spend - Daily spend rows from Meta
 * @param qualified - `MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED` counts by date × source
 * @param booked - `MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE` counts by date × source
 * @returns Joined rows sorted newest first, matching the sheet's row order
 */
export function joinMarketingDaily(
  spend: MetaDailySpend[],
  qualified: EventDailyCounts[],
  booked: EventDailyCounts[]
): MarketingDailyRow[] {
  const spendByDate = new Map(spend.map((s) => [s.date, s]));
  const qualifiedByDate = bucketByChannel(qualified);
  const bookedByDate = bucketByChannel(booked);

  const dates = new Set([
    ...spendByDate.keys(),
    ...Object.keys(qualifiedByDate),
    ...Object.keys(bookedByDate),
  ]);

  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({
      date,
      fbSpend: round2(spendByDate.get(date)?.spend ?? 0),
      fbImpressions: spendByDate.get(date)?.impressions ?? 0,
      fbClicks: spendByDate.get(date)?.clicks ?? 0,
      fbQualified: qualifiedByDate[date]?.fb ?? 0,
      fbBooked: bookedByDate[date]?.fb ?? 0,
      otherQualified: qualifiedByDate[date]?.other ?? 0,
      otherBooked: bookedByDate[date]?.other ?? 0,
    }));
}

/**
 * Convert joined rows to the sheet's cell matrix.
 *
 * @param rows - Joined daily rows
 */
export function toSheetValues(rows: MarketingDailyRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.date,
    r.fbSpend,
    r.fbImpressions,
    r.fbClicks,
    r.fbQualified,
    r.fbBooked,
    r.otherQualified,
    r.otherBooked,
  ]);
}

/**
 * Merge freshly fetched rows over existing ones, keyed by date.
 *
 * Meta restates spend for 24–48h as billing reconciles and attribution windows
 * close, so the last few days are never final on first fetch. Fresh rows always
 * win; older dates outside the refetch window are preserved.
 *
 * @param existing - Rows already in the sheet
 * @param fresh - Rows just fetched (typically the last 7 days)
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
 * Check whether the newest row is older than expected.
 *
 * This is the check Motion's sheet does not have. Their Facebook connector died
 * on 2026-04-06 and every layer downstream kept reporting success — dbt ran, the
 * sync ran, the sheet rendered — while `FB_SPEND` read $0 for three months. No
 * link in the chain was responsible for asking whether the number was real.
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

  // Spend that is zero across every recent day means the Meta side is broken, not
  // that we stopped advertising. This is the exact failure Motion missed.
  const recent = rows.slice(0, maxAgeDays + 1);
  const allZeroSpend = recent.length > 0 && recent.every((r) => r.fbSpend === 0);

  if (allZeroSpend) {
    return `marketing sheet: FB_SPEND is $0 across the last ${recent.length} days — Meta side is probably broken, not paused`;
  }

  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
