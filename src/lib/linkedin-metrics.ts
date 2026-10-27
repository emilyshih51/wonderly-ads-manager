/**
 * LinkedIn Daily Metrics — a self-contained tab for the LinkedIn test, kept separate from
 * Daily Metrics on purpose so nothing about the trusted FB/Organic tab changes.
 *
 * LinkedIn's funnel is shorter than the website's: the ad (or retargeting message) links
 * straight to the form on hi.wonderly.com, so there is no landing page / CTA step. Columns
 * run forward in funnel order:
 *
 *   Spend → Impressions → LP clicks (CPC) → Engagements → Form opened → Partial → Qualified
 *     → Call 1 booked → Direct booked → All booked → Held → No show → Accepted
 *
 * - Spend / impressions / clicks / engagements come from LinkedIn's Advertising API.
 * - Everything from Form opened on comes from Amplitude + the CRM (Snowflake), using the
 *   same rules as Daily Metrics (see `SnowflakeService.getLinkedinFunnel`).
 * - Direct booked = the `?mode=book` link that skips the form; All booked = Call 1 + Direct.
 *
 * Summary rows (Since launch / Last 7d / MTD) use RATIO OF TOTALS for every cost-per. Last 7d
 * excludes today's partial day, matching the Overview tab.
 *
 * Maturation caveat (same as the rest of the sheet): Held / No show / Accepted are cohort
 * metrics keyed to booking day, so recent rows read low until deals work through the
 * pipeline. Judge the test on Since launch, not the newest days.
 */

import type { LinkedInDailySpend } from '@/services/linkedin';

/** One day of the LinkedIn funnel from Snowflake. */
export interface LinkedinFunnelRow {
  date: string;
  formOpened: number;
  partial: number;
  qualified: number;
  call1Booked: number;
  directBooked: number;
  held: number;
  noShow: number;
  accepted: number;
}

/** A day with LinkedIn delivery and funnel joined. */
export interface LinkedinDay extends LinkedinFunnelRow {
  spend: number;
  impressions: number;
  clicks: number;
  engagements: number;
}

export const LINKEDIN_METRICS_HEADERS = [
  'Date',
  'Spend',
  'Impressions',
  'LP clicks',
  'CPC',
  'Engagements',
  'Form opened',
  'Cost / form',
  'Partial',
  'Cost / partial',
  'Qualified',
  'Cost / qualified',
  'Call 1 booked',
  'Direct booked',
  'All booked',
  'Cost / booked',
  'Held',
  'Cost / held',
  'No show',
  'Accepted',
  'Cost / accepted',
] as const;

const ZERO: Omit<LinkedinDay, 'date'> = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  engagements: 0,
  formOpened: 0,
  partial: 0,
  qualified: 0,
  call1Booked: 0,
  directBooked: 0,
  held: 0,
  noShow: 0,
  accepted: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Spend ÷ count, blank when there's nothing to divide by. */
function costPer(spend: number, count: number): number | '' {
  return count > 0 ? round2(spend / count) : '';
}

/**
 * Join LinkedIn delivery to the Snowflake funnel on date. A date in either source produces a
 * row: spend with no funnel is a real (dead) day; funnel with no spend is a LinkedIn-tagged
 * visit outside a paid flight (e.g. a hand-tagged message link). Days before LinkedIn's first
 * activity are dropped so the tab starts at launch.
 */
export function joinLinkedinDays(
  spend: LinkedInDailySpend[],
  funnel: LinkedinFunnelRow[]
): LinkedinDay[] {
  const byDate = new Map<string, LinkedinDay>();

  for (const s of spend) {
    byDate.set(s.date, {
      ...ZERO,
      date: s.date,
      spend: s.spend,
      impressions: s.impressions,
      clicks: s.landingPageClicks,
      engagements: s.engagements,
    });
  }

  for (const f of funnel) {
    const d = byDate.get(f.date) ?? { ...ZERO, date: f.date };

    byDate.set(f.date, { ...d, ...f, date: f.date });
  }

  const hasActivity = (d: LinkedinDay) =>
    d.spend > 0 ||
    d.impressions > 0 ||
    d.formOpened > 0 ||
    d.partial > 0 ||
    d.qualified > 0 ||
    d.call1Booked > 0 ||
    d.directBooked > 0 ||
    d.held > 0 ||
    d.noShow > 0 ||
    d.accepted > 0;

  const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  const firstActive = days.filter(hasActivity).at(-1)?.date;

  return firstActive ? days.filter((d) => d.date >= firstActive) : [];
}

/** Sum a set of days into one total. */
export function sumDays(days: LinkedinDay[]): Omit<LinkedinDay, 'date'> {
  return days.reduce(
    (acc, d) => {
      for (const k of Object.keys(ZERO) as (keyof typeof ZERO)[]) acc[k] += d[k];

      return acc;
    },
    { ...ZERO }
  );
}

/** One sheet row (any label in the Date column) from a day or a summed window. */
function toRow(label: string, t: Omit<LinkedinDay, 'date'>): (string | number)[] {
  const allBooked = t.call1Booked + t.directBooked;

  return [
    label,
    round2(t.spend),
    t.impressions,
    t.clicks,
    costPer(t.spend, t.clicks),
    t.engagements,
    t.formOpened,
    costPer(t.spend, t.formOpened),
    t.partial,
    costPer(t.spend, t.partial),
    t.qualified,
    costPer(t.spend, t.qualified),
    t.call1Booked,
    t.directBooked,
    allBooked,
    costPer(t.spend, allBooked),
    t.held,
    costPer(t.spend, t.held),
    t.noShow,
    t.accepted,
    costPer(t.spend, t.accepted),
  ];
}

/** Shift a `YYYY-MM-DD` by whole days. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() + n);

  return d.toISOString().slice(0, 10);
}

/**
 * Build the tab's data rows (header excluded): three summary rows, a blank spacer, then one
 * row per day newest first.
 *
 * @param days - Output of {@link joinLinkedinDays}, newest first
 * @param ptToday - Today in America/Los_Angeles (`YYYY-MM-DD`) — excluded from Last 7d
 */
export function toLinkedinMetricsValues(
  days: LinkedinDay[],
  ptToday: string
): (string | number)[][] {
  if (days.length === 0) {
    return [['No LinkedIn activity yet — rows appear once the first campaign spends.']];
  }

  const sevenStart = addDays(ptToday, -7);
  const last7 = days.filter((d) => d.date >= sevenStart && d.date < ptToday);
  const mtd = days.filter((d) => d.date.slice(0, 7) === ptToday.slice(0, 7));

  return [
    toRow('Since launch', sumDays(days)),
    toRow('Last 7d', sumDays(last7)),
    toRow('MTD', sumDays(mtd)),
    [],
    ...days.map((d) => toRow(d.date, d)),
  ];
}

/** Number of leading summary rows (after the header) — the formatter bolds these. */
export const LINKEDIN_SUMMARY_ROWS = 3;

/** Indices (0-based) of currency columns, for formatting. */
export const LINKEDIN_CURRENCY_COLUMNS = LINKEDIN_METRICS_HEADERS.map((h, i) =>
  h === 'Spend' || h === 'CPC' || h.startsWith('Cost /') ? i : -1
).filter((i) => i >= 0);

/**
 * Sheets batchUpdate requests: freeze header + date column, bold header and summary rows,
 * currency format on spend / cost columns.
 */
export function buildLinkedinMetricsFormatRequests(
  sheetId: number,
  rowCount: number
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 + LINKEDIN_SUMMARY_ROWS },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
  ];

  for (const col of LINKEDIN_CURRENCY_COLUMNS) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount + 1,
          startColumnIndex: col,
          endColumnIndex: col + 1,
        },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  return requests;
}
