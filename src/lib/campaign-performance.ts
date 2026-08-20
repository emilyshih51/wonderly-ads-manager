/**
 * Campaign Performance — one row per Meta campaign showing how many Call 1s it booked,
 * how many held and accepted, its accept rate, its window spend, and cost per accepted
 * contractor. Written to the `Campaign Performance` tab.
 *
 * Booked/held/accepted are counted from the deal-level `call1_deals` rows (each deal is
 * attributed to the campaign in its `utm_medium`). Spend comes from the Meta API at the
 * campaign level over the same backfill window. Cost per accepted carries the same
 * booking-day cohort caveat as `historical_cac` — recent campaigns read high until their
 * cohort matures — and blank COST_PER_ACCEPTED means spend with no acceptances yet.
 */

import type { Call1DealRow } from '@/lib/call1-deals';
import type { SheetsRequest } from '@/lib/daily-metrics-format';

/** Total spend for one Meta campaign over a date range (from the Meta API). */
export interface MetaCampaignSpend {
  /** Meta campaign id. */
  campaignId: string;
  /** Current display name of the campaign. */
  campaignName: string;
  /** Spend over the requested window, in account currency. */
  spend: number;
}

/** One campaign's booked → held → accepted yield, plus spend and CAC. */
export interface CampaignPerformanceRow {
  /** Display name (campaign name, else the raw id, else the organic bucket label). */
  campaign: string;
  booked: number;
  held: number;
  accepted: number;
  /** accepted ÷ booked, 0–1; 0 when nothing booked. */
  acceptRate: number;
  /** Meta spend attributed to this campaign over the window. */
  spend: number;
  /** spend ÷ accepted; 0 when no acceptances yet. */
  costPerAccepted: number;
}

/** Column order for the Campaign Performance tab. */
export const CAMPAIGN_PERFORMANCE_HEADERS = [
  'CAMPAIGN',
  'CALL1_BOOKED',
  'HELD',
  'ACCEPTED',
  'ACCEPT_RATE',
  'SPEND',
  'COST_PER_ACCEPTED',
] as const;

/** Label for deals with no numeric Meta campaign id (organic / unattributed). */
const ORGANIC_LABEL = '(no campaign / organic)';

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

interface Agg {
  campaignId: string;
  name: string;
  booked: number;
  held: number;
  accepted: number;
  spend: number;
}

/**
 * Aggregate deal rows and campaign spend into a per-campaign performance table.
 *
 * Campaigns appear if they produced any deal OR spent in the window (so zero-yield spend
 * is visible for CAC). Deals with no campaign id fall into a single organic bucket.
 *
 * @param deals - Deal-level rows (each carrying `campaignId` and, ideally, `campaignName`)
 * @param campaignSpend - Per-campaign window spend from the Meta API (also a name source)
 * @returns Rows sorted by accepted (then booked, then spend) descending
 */
export function computeCampaignPerformance(
  deals: Call1DealRow[],
  campaignSpend: MetaCampaignSpend[]
): CampaignPerformanceRow[] {
  const byId = new Map<string, Agg>();

  const ensure = (campaignId: string): Agg => {
    const key = campaignId || '';
    const cur =
      byId.get(key) ??
      ({ campaignId: key, name: '', booked: 0, held: 0, accepted: 0, spend: 0 } as Agg);

    byId.set(key, cur);

    return cur;
  };

  for (const d of deals) {
    const a = ensure(d.campaignId);

    a.booked += 1;
    a.held += d.held;
    a.accepted += d.accepted;
    if (!a.name && d.campaignName) a.name = d.campaignName;
  }

  for (const c of campaignSpend) {
    if (!c.campaignId) continue;

    const a = ensure(c.campaignId);

    a.spend += c.spend;
    if (!a.name && c.campaignName) a.name = c.campaignName;
  }

  return [...byId.values()]
    .map((a) => ({
      campaign: a.campaignId ? a.name || a.campaignId : ORGANIC_LABEL,
      booked: a.booked,
      held: a.held,
      accepted: a.accepted,
      acceptRate: rate(a.accepted, a.booked),
      spend: money(a.spend),
      costPerAccepted: a.accepted > 0 ? money(a.spend / a.accepted) : 0,
    }))
    .sort((x, y) => y.accepted - x.accepted || y.booked - x.booked || y.spend - x.spend);
}

/**
 * Convert campaign rows to the sheet's cell matrix, in header order, with a bold-worthy
 * Total row appended. Accept rate is blank when nothing booked; cost per accepted is blank
 * when there are no acceptances (so "spend, no accepts yet" doesn't render as $0).
 *
 * @param rows - Campaign rows from {@link computeCampaignPerformance}
 */
export function toCampaignPerformanceValues(rows: CampaignPerformanceRow[]): (string | number)[][] {
  const body = rows.map((r) => [
    r.campaign,
    r.booked,
    r.held,
    r.accepted,
    r.booked > 0 ? r.acceptRate : '',
    r.spend,
    r.accepted > 0 ? r.costPerAccepted : '',
  ]);

  const totals = rows.reduce(
    (t, r) => ({
      booked: t.booked + r.booked,
      held: t.held + r.held,
      accepted: t.accepted + r.accepted,
      spend: t.spend + r.spend,
    }),
    { booked: 0, held: 0, accepted: 0, spend: 0 }
  );

  return [
    ...body,
    [
      'Total',
      totals.booked,
      totals.held,
      totals.accepted,
      totals.booked > 0 ? rate(totals.accepted, totals.booked) : '',
      money(totals.spend),
      totals.accepted > 0 ? money(totals.spend / totals.accepted) : '',
    ],
  ];
}

/**
 * Formatting for the Campaign Performance tab: bold frozen header, percent on ACCEPT_RATE,
 * currency on SPEND / COST_PER_ACCEPTED, and a bold Total row.
 *
 * @param sheetId - The tab's numeric gid
 * @param rowCount - Number of value rows written below the header (incl. the Total row)
 */
export function buildCampaignPerformanceFormatRequests(
  sheetId: number,
  rowCount: number
): SheetsRequest[] {
  const CURRENCY = { type: 'CURRENCY', pattern: '"$"#,##0' };
  const PERCENT = { type: 'PERCENT', pattern: '0.0%' };
  const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
  const dataEnd = rowCount + 1; // +1 for the header row
  const totalRow = rowCount; // 0-based index of the Total row (header + rowCount-1)

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
    col(4, PERCENT), // ACCEPT_RATE
    col(5, CURRENCY), // SPEND
    col(6, CURRENCY), // COST_PER_ACCEPTED
    // Bold the Total row.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: totalRow, endRowIndex: totalRow + 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
  ];
}
