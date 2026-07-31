/**
 * Historical CAC — cost to acquire an accepted contractor, month by month.
 *
 * One row per booking month plus an all-time total: FB spend that month ÷ accepted
 * contractors from that month's booking cohort (of the deals booked that month, how many
 * eventually accepted). Recent months are flagged "maturing" — their cohort hasn't
 * finished converting, so CAC reads high — leaving the all-time row and older months as
 * the stable figures. Values are computed in code and rewritten each cron run (so past
 * months refine as their cohorts mature). Written to the `historical_cac` tab.
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';
import type { SheetsRequest } from '@/lib/daily-metrics-format';

/** Column order for the historical_cac tab. */
export const HISTORICAL_CAC_HEADERS = [
  'MONTH',
  'FB_SPEND',
  'CALL1_BOOKED',
  'ACCEPTED',
  'ACCEPT_RATE',
  'CAC',
  'NOTE',
] as const;

/** A booking cohort younger than this (days) hasn't fully converted — flag it "maturing". */
const MATURING_DAYS = 60;

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

/** Last calendar day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
function monthEndIso(ym: string): string {
  const [y, m] = ym.split('-').map(Number);

  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** `today` minus `MATURING_DAYS`, as `YYYY-MM-DD`. */
function maturityCutoff(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() - MATURING_DAYS);

  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate daily rows into a monthly CAC trend + all-time total.
 *
 * @param rows - Daily rows (any order); each carries FB spend, Call 1 bookings, and
 *   cohort-keyed accepted for its date
 * @param today - Pacific `YYYY-MM-DD`, to flag still-maturing recent months
 * @returns Month rows (oldest first), an all-time total, and a definition note
 */
export function toHistoricalCacValues(
  rows: MarketingDailyRow[],
  today: string
): (string | number)[][] {
  const byMonth = new Map<string, { spend: number; booked: number; accepted: number }>();
  let totalSpend = 0;
  let totalBooked = 0;
  let totalAccepted = 0;

  for (const r of rows) {
    const mo = r.date.slice(0, 7);
    const cur = byMonth.get(mo) ?? { spend: 0, booked: 0, accepted: 0 };

    cur.spend += r.fbSpend;
    cur.booked += r.bookedAll;
    cur.accepted += r.accepted;
    byMonth.set(mo, cur);
    totalSpend += r.fbSpend;
    totalBooked += r.bookedAll;
    totalAccepted += r.accepted;
  }

  const cutoff = maturityCutoff(today);

  const monthRows: (string | number)[][] = [...byMonth.keys()].sort().map((mo) => {
    const { spend, booked, accepted } = byMonth.get(mo) as {
      spend: number;
      booked: number;
      accepted: number;
    };
    const maturing = monthEndIso(mo) > cutoff;

    return [
      mo,
      money(spend),
      booked,
      accepted,
      rate(accepted, booked),
      accepted > 0 ? money(spend / accepted) : 0,
      maturing ? 'maturing' : '',
    ];
  });

  return [
    ...monthRows,
    [
      'All-time',
      money(totalSpend),
      totalBooked,
      totalAccepted,
      rate(totalAccepted, totalBooked),
      totalAccepted > 0 ? money(totalSpend / totalAccepted) : 0,
      '',
    ],
    [],
    [
      'CAC = FB spend ÷ accepted contractors (booking-day cohort). "maturing" months are too recent for their cohort to have finished converting, so CAC reads high; the all-time row is the stable figure.',
    ],
  ];
}

/**
 * Formatting for the historical_cac tab: bold header, currency on FB_SPEND / CAC, percent
 * on ACCEPT_RATE, a bold all-time row, and sensible widths.
 *
 * @param sheetId - The tab's numeric gid
 * @param rowCount - Number of value rows written below the header (from toHistoricalCacValues)
 */
export function buildHistoricalCacFormatRequests(
  sheetId: number,
  rowCount: number
): SheetsRequest[] {
  const CURRENCY = { type: 'CURRENCY', pattern: '"$"#,##0' };
  const PERCENT = { type: 'PERCENT', pattern: '0.0%' };
  const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
  const dataEnd = rowCount + 1; // +1 for the header row

  const col = (index: number, fmt: Record<string, string>): SheetsRequest => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: dataEnd,
        startColumnIndex: index,
        endColumnIndex: index + 1,
      },
      cell: { userEnteredFormat: { numberFormat: fmt } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });

  return [
    // Header row: bold + shaded, frozen.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_BG } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    col(1, CURRENCY), // FB_SPEND
    col(4, PERCENT), // ACCEPT_RATE
    col(5, CURRENCY), // CAC
  ];
}
