/**
 * Pure functions for building the marketing performance sheet's raw (wonderly_daily) tab.
 *
 * Two sources, one join. Meta knows what we spent; Snowflake (Amplitude + the
 * WONDERLY_SALES pipeline) knows the funnel, the counts by source, and the sales stages.
 * Neither knows the other — these functions put both in the same row because they share
 * a date.
 *
 * Every funnel step and the held/accepted outcomes are split five ways by acquisition
 * source: Facebook, Google, Yahoo, Bing, and N/A (unattributed). The column list is
 * defined once in `RAW_COLUMNS`, which drives the header row, the cell matrix, and the
 * read-back parser, so the 35 split columns can never fall out of alignment.
 *
 * Deliberately free of I/O so the join can be unit tested without hitting Snowflake or
 * Meta.
 */

/** Daily spend as reported by the Meta Marketing API, one entry per day. */
export interface MetaDailySpend {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * One aggregated day of funnel + source-split + sales-stage counts from Snowflake.
 * Counts are unique people per stage (funnel) / deals (sales stages). Each split field
 * is one of five acquisition-source buckets: `Fb`, `Google`, `Yahoo`, `Bing`, `Na`.
 */
export interface DailyMarketingRow {
  date: string;

  pageView: number;
  pageViewFb: number;
  pageViewGoogle: number;
  pageViewYahoo: number;
  pageViewBing: number;
  pageViewNa: number;

  ctaClicked: number;
  ctaFb: number;
  ctaGoogle: number;
  ctaYahoo: number;
  ctaBing: number;
  ctaNa: number;

  submitPartial: number;
  submitPartialFb: number;
  submitPartialGoogle: number;
  submitPartialYahoo: number;
  submitPartialBing: number;
  submitPartialNa: number;

  submitQualified: number;
  submitQualifiedFb: number;
  submitQualifiedGoogle: number;
  submitQualifiedYahoo: number;
  submitQualifiedBing: number;
  submitQualifiedNa: number;

  /** BOOKING_COMPLETE count. The single booking number; rates divide by this. */
  bookedAll: number;
  bookedFb: number;
  bookedGoogle: number;
  bookedYahoo: number;
  bookedBing: number;
  bookedNa: number;

  /** Of that day's booked deals, how many ever reached "Accepted" (milestone). */
  accepted: number;
  acceptedFb: number;
  acceptedGoogle: number;
  acceptedYahoo: number;
  acceptedBing: number;
  acceptedNa: number;

  /** Booked deals whose Call 1 happened (milestone). */
  held: number;
  heldFb: number;
  heldGoogle: number;
  heldYahoo: number;
  heldBing: number;
  heldNa: number;

  /** Booked deals currently a no-show. */
  noShow: number;
  /** Booked deals currently disqualified/lost. */
  disqualifiedLost: number;
}

/** One fully joined day, ready to write to the wonderly_daily tab. */
export interface MarketingDailyRow extends DailyMarketingRow {
  fbSpend: number;
  fbImpressions: number;
  fbClicks: number;
}

/** Source buckets, in priority order, with their column-header suffix. */
export const SOURCE_BUCKETS = [
  { field: 'Fb', header: 'FB' },
  { field: 'Google', header: 'GOOGLE' },
  { field: 'Yahoo', header: 'YAHOO' },
  { field: 'Bing', header: 'BING' },
  { field: 'Na', header: 'NA' },
] as const;

/** A metric that splits by source: its ALL field/header, and the split field/header prefixes. */
const SPLIT_METRICS: {
  allKey: keyof MarketingDailyRow;
  allHeader: string;
  fieldPrefix: string;
  headerPrefix: string;
}[] = [
  {
    allKey: 'pageView',
    allHeader: 'PAGE_VIEW',
    fieldPrefix: 'pageView',
    headerPrefix: 'PAGE_VIEW',
  },
  { allKey: 'ctaClicked', allHeader: 'CTA_CLICKED', fieldPrefix: 'cta', headerPrefix: 'CTA' },
  {
    allKey: 'submitPartial',
    allHeader: 'SUBMIT_PARTIAL',
    fieldPrefix: 'submitPartial',
    headerPrefix: 'PARTIAL',
  },
  {
    allKey: 'submitQualified',
    allHeader: 'SUBMIT_QUALIFIED',
    fieldPrefix: 'submitQualified',
    headerPrefix: 'QUALIFIED',
  },
  { allKey: 'bookedAll', allHeader: 'BOOKED_ALL', fieldPrefix: 'booked', headerPrefix: 'BOOKED' },
  { allKey: 'accepted', allHeader: 'ACCEPTED', fieldPrefix: 'accepted', headerPrefix: 'ACCEPTED' },
  { allKey: 'held', allHeader: 'HELD', fieldPrefix: 'held', headerPrefix: 'HELD' },
];

interface RawColumn {
  key: keyof MarketingDailyRow;
  header: string;
}

/** The wonderly_daily column contract: order drives headers, values, and the parser. */
const RAW_COLUMNS: RawColumn[] = [
  { key: 'date', header: 'DATE' },
  { key: 'fbSpend', header: 'FB_SPEND' },
  { key: 'fbImpressions', header: 'FB_IMPRESSIONS' },
  { key: 'fbClicks', header: 'FB_CLICKS' },
  ...SPLIT_METRICS.flatMap((m): RawColumn[] => [
    { key: m.allKey, header: m.allHeader },
    ...SOURCE_BUCKETS.map(
      (b): RawColumn => ({
        key: `${m.fieldPrefix}${b.field}` as keyof MarketingDailyRow,
        header: `${m.headerPrefix}_${b.header}`,
      })
    ),
  ]),
  { key: 'noShow', header: 'NO_SHOW' },
  { key: 'disqualifiedLost', header: 'DISQUALIFIED_LOST' },
];

/** Header row for the wonderly_daily tab. */
export const RAW_TAB_HEADERS = RAW_COLUMNS.map((c) => c.header);

/** wonderly_daily columns that are not part of the Snowflake (DailyMarketingRow) side. */
const SPEND_KEYS = new Set(['date', 'fbSpend', 'fbImpressions', 'fbClicks']);

/** A fully-zeroed MarketingDailyRow for the given date. Handy for tests and defaults. */
export function blankMarketingRow(date: string): MarketingDailyRow {
  return { ...emptyMarketing(date), fbSpend: 0, fbImpressions: 0, fbClicks: 0 };
}

/** A zeroed DailyMarketingRow for a date with no Snowflake data. */
function emptyMarketing(date: string): DailyMarketingRow {
  const row = { date } as DailyMarketingRow;

  for (const c of RAW_COLUMNS) {
    if (!SPEND_KEYS.has(c.key)) (row as unknown as Record<string, number | string>)[c.key] = 0;
  }

  return row;
}

/**
 * Join Meta spend to the Snowflake funnel on date.
 *
 * @param spend - Daily spend rows from the Meta API
 * @param marketing - Daily funnel/source-split/sales rows from Snowflake
 * @returns Joined rows sorted newest first
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
      const m = marketingByDate.get(date) ?? emptyMarketing(date);

      return {
        ...m,
        date,
        fbSpend: round2(s?.spend ?? 0),
        fbImpressions: s?.impressions ?? 0,
        fbClicks: s?.clicks ?? 0,
      };
    });
}

/**
 * Convert joined rows to the sheet's cell matrix, in RAW_COLUMNS order.
 *
 * @param rows - Joined daily rows
 */
export function toSheetValues(rows: MarketingDailyRow[]): (string | number)[][] {
  return rows.map((r) => RAW_COLUMNS.map((c) => r[c.key]));
}

/**
 * Parse the sheet's cell matrix (header row first) back into rows, using RAW_COLUMNS so
 * the positions always match what `toSheetValues` wrote.
 *
 * @param values - Raw cell matrix read from wonderly_daily
 */
export function parseMarketingRows(values: (string | number)[][]): MarketingDailyRow[] {
  return values
    .slice(1)
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row[0] ?? '')))
    .map((row) => {
      const r = {} as MarketingDailyRow;

      RAW_COLUMNS.forEach((c, i) => {
        if (c.key === 'date') r.date = String(row[i]);
        else (r as unknown as Record<string, number | string>)[c.key] = num(row[i]);
      });

      return r;
    });
}

/**
 * Merge freshly fetched rows over existing ones, keyed by date.
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

function num(value: string | number | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
