/**
 * SEO Funnel — the acquisition funnel split by channel, with organic search in the
 * foreground and every other channel alongside it for comparison.
 *
 * One row per day: the full SEO funnel (sessions → CTA → partial → qualified → Call 1
 * booked → held → accepted) with its step conversions, then a compact
 * booked/accepted block for AI search, direct, referral and Facebook so the question
 * "is SEO worth it next to paid?" is answerable without leaving the tab.
 *
 * SEO has no media cost, so there is no cost-per column here — the paid economics live on
 * Daily Funnel and Campaign Performance. The unit of investment for SEO is the PAGE, which
 * is what the companion `SEO Pages` tab reports.
 *
 * Maturation caveat, same as everywhere else in this sheet: HELD and ACCEPTED are cohort
 * metrics keyed to the booking day, so the most recent ~30 days read low until those deals
 * work through the pipeline. Read the trend, not the last row.
 */

import { CHANNELS, CHANNEL_PREFIX, type Channel } from '@/lib/channel';
import type { SheetsRequest } from '@/lib/daily-metrics-format';

/** One day of one channel's funnel, as returned by `SnowflakeService.getChannelFunnel`. */
export interface ChannelFunnelRow {
  /** `YYYY-MM-DD`, bucketed on the report timezone. */
  date: string;
  channel: Channel;
  /** Unique people with a page view that day (flow metric). */
  sessions: number;
  cta: number;
  submitPartial: number;
  submitQualified: number;
  /** Marketing-qualified leads who booked, keyed to their QUALIFIED day. */
  booked: number;
  /** Cohort metric keyed to booking day: of that day's bookings, how many held. */
  held: number;
  noShow: number;
  /** Cohort metric keyed to booking day: of that day's bookings, how many were accepted. */
  accepted: number;
}

/** Channels shown in the compact comparison block, in display order. */
const COMPARISON_CHANNELS: Channel[] = ['ai', 'direct', 'referral', 'fb'];

/** Column order for the SEO Funnel tab. */
export const SEO_FUNNEL_HEADERS = [
  'DATE',
  'SEO_SESSIONS',
  'SEO_CTA',
  'SEO_CTA_RATE',
  'SEO_PARTIAL',
  'SEO_PARTIAL_RATE',
  'SEO_QUALIFIED',
  'SEO_QUAL_RATE',
  'SEO_CALL1_BOOKED',
  'SEO_CALL1_RATE',
  'SEO_HELD',
  'SEO_HELD_RATE',
  'SEO_NO_SHOW',
  'SEO_ACCEPTED',
  'SEO_ACCEPT_RATE',
  'SEO_SESSION_TO_ACCEPTED',
  ...COMPARISON_CHANNELS.flatMap((c) => [
    `${CHANNEL_PREFIX[c]}_SESSIONS`,
    `${CHANNEL_PREFIX[c]}_CALL1_BOOKED`,
    `${CHANNEL_PREFIX[c]}_ACCEPTED`,
  ]),
] as const;

/** Index of the first comparison-block column (used by the formatter's shading). */
export const SEO_FUNNEL_COMPARISON_START = 16;

/** Zero-filled funnel row, used for a channel with no activity on a given day. */
const EMPTY = {
  sessions: 0,
  cta: 0,
  submitPartial: 0,
  submitQualified: 0,
  booked: 0,
  held: 0,
  noShow: 0,
  accepted: 0,
};

type Counts = typeof EMPTY;

/** Conversion ratio, div-by-zero safe, 4 dp (a fraction; format the cell as %). */
function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

/**
 * Pivot the long (day, channel) rows into one wide row per day, newest day first.
 *
 * Days are taken from the input rather than generated, so a day with no events anywhere
 * simply doesn't appear — the same behaviour as Daily Funnel.
 *
 * @param rows - Long-format rows from `getChannelFunnel`
 * @returns Map of date → channel → counts, plus the dates in descending order
 */
export function pivotChannelFunnel(rows: ChannelFunnelRow[]): {
  dates: string[];
  byDate: Map<string, Map<Channel, Counts>>;
} {
  const byDate = new Map<string, Map<Channel, Counts>>();

  for (const r of rows) {
    const day = byDate.get(r.date) ?? new Map<Channel, Counts>();

    byDate.set(r.date, day);
    day.set(r.channel, {
      sessions: r.sessions,
      cta: r.cta,
      submitPartial: r.submitPartial,
      submitQualified: r.submitQualified,
      booked: r.booked,
      held: r.held,
      noShow: r.noShow,
      accepted: r.accepted,
    });
  }

  return { dates: [...byDate.keys()].sort((a, b) => b.localeCompare(a)), byDate };
}

/**
 * Build the SEO Funnel cell matrix in {@link SEO_FUNNEL_HEADERS} order.
 *
 * A leading `Total` row sums the whole window (rates recomputed as ratio-of-totals, not a
 * mean of daily rates) so the headline SEO conversion is readable without selecting rows.
 *
 * @param rows - Long-format rows from `getChannelFunnel`
 * @param minDate - Floor date (`YYYY-MM-DD`); older rows are dropped
 */
export function toSeoFunnelValues(
  rows: ChannelFunnelRow[],
  minDate: string
): (string | number)[][] {
  const { dates, byDate } = pivotChannelFunnel(rows.filter((r) => r.date >= minDate));

  const get = (date: string, channel: Channel): Counts => byDate.get(date)?.get(channel) ?? EMPTY;

  const body = dates.map((date) => {
    const seo = get(date, 'seo');

    return [
      date,
      seo.sessions,
      seo.cta,
      rate(seo.cta, seo.sessions),
      seo.submitPartial,
      rate(seo.submitPartial, seo.cta),
      seo.submitQualified,
      rate(seo.submitQualified, seo.submitPartial),
      seo.booked,
      rate(seo.booked, seo.submitQualified),
      seo.held,
      rate(seo.held, seo.booked),
      seo.noShow,
      seo.accepted,
      rate(seo.accepted, seo.booked),
      rate(seo.accepted, seo.sessions),
      ...COMPARISON_CHANNELS.flatMap((c) => {
        const x = get(date, c);

        return [x.sessions, x.booked, x.accepted];
      }),
    ];
  });

  const sum = (channel: Channel, key: keyof Counts): number =>
    dates.reduce((t, d) => t + get(d, channel)[key], 0);

  const t = Object.fromEntries(
    (Object.keys(EMPTY) as (keyof Counts)[]).map((k) => [k, sum('seo', k)])
  ) as Counts;

  const total = [
    'Total',
    t.sessions,
    t.cta,
    rate(t.cta, t.sessions),
    t.submitPartial,
    rate(t.submitPartial, t.cta),
    t.submitQualified,
    rate(t.submitQualified, t.submitPartial),
    t.booked,
    rate(t.booked, t.submitQualified),
    t.held,
    rate(t.held, t.booked),
    t.noShow,
    t.accepted,
    rate(t.accepted, t.booked),
    rate(t.accepted, t.sessions),
    ...COMPARISON_CHANNELS.flatMap((c) => [
      sum(c, 'sessions'),
      sum(c, 'booked'),
      sum(c, 'accepted'),
    ]),
  ];

  return [total, ...body];
}

/** Column indexes holding a rate (formatted as a percent). */
const RATE_COLUMNS = [3, 5, 7, 9, 11, 14, 15];

/**
 * Formatting for the SEO Funnel tab: frozen bold header, bold Total row, percent number
 * formats on the rate columns, and a tinted background over the comparison block so the
 * SEO funnel proper reads as the primary content.
 *
 * @param sheetId - The tab's numeric gid
 * @param rowCount - Number of value rows written below the header (incl. the Total row)
 */
export function buildSeoFunnelFormatRequests(sheetId: number, rowCount: number): SheetsRequest[] {
  const PERCENT = { type: 'PERCENT', pattern: '0.0%' };
  const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
  const COMPARISON_BG = { red: 0.97, green: 0.97, blue: 0.98 };
  const dataEnd = rowCount + 1;

  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_BG } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } },
        fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
      },
    },
    // Comparison block gets a tint first, so the per-column number formats below win.
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: dataEnd,
          startColumnIndex: SEO_FUNNEL_COMPARISON_START,
          endColumnIndex: SEO_FUNNEL_HEADERS.length,
        },
        cell: { userEnteredFormat: { backgroundColor: COMPARISON_BG } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    },
    ...RATE_COLUMNS.map((index) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: dataEnd,
          startColumnIndex: index,
          endColumnIndex: index + 1,
        },
        cell: { userEnteredFormat: { numberFormat: PERCENT } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })),
    // Bold the leading Total row.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
  ];
}

/** Every channel the tab knows about — re-exported so the Definitions tab can enumerate them. */
export { CHANNELS };
