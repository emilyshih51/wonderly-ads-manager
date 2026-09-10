/**
 * Ad Winners — ranks Meta ads by lead volume (Results) and cost-per-lead (CPL) across four
 * rolling windows (Last 7/14/30 Days, All Time) and flags "winners": ads worth scaling,
 * duplicating, or feeding into an automation rule's target ad set.
 *
 * Written to the `wonderly_winners` Google Sheet by `GET /api/cron/ad-winners` (weekly).
 * Started as a sheet Emily rebuilt by hand from Ads Manager each week — this cron keeps it
 * current going forward, matching the columns, per-window thresholds, and Ads Manager links
 * she'd already established.
 *
 * A promoted ad's leading `"+ "` (see `PROMOTED_AD_MARKER` in `services/meta/constants.ts`)
 * and a duplicated winner's trailing `" [Winner Copy]"` (see `MetaService.duplicateAd`) are
 * NOT reproduced here — they're already part of the ad's real name in Meta once the
 * automation engine has touched it, so they come through for free via `ad_name`.
 */

import { parseInsightMetrics } from './automation-utils';
import { buildAdsManagerAdLink } from './ads-manager-link';
import type { SheetsRequest } from './daily-metrics-format';
import type { MetaInsightsRow } from '@/types';

/** One rolling-window tab on the Ad Winners sheet. */
export interface AdWinnerWindow {
  /** Exact tab name this window writes to (must match the existing sheet's tab names). */
  tabName: string;
  /** Meta `date_preset` for the ad-level insights query. */
  datePreset: string;
  /** Minimum Results (conversions) for an ad to be considered a winner candidate at all. */
  minResults: number;
  /** Maximum cost-per-result (CPL) to count as a full winner. */
  cplCap: number;
  /**
   * When true, ads whose ad set optimizes for `COMPLETE_REGISTRATION` are excluded from this
   * window so trial-optimized and registration-optimized ads are never compared on the same
   * CPL scale. Inferred from the existing sheet's "All Time" caveat — confirm with Emily if
   * new registration-optimized campaigns start showing up (or disappearing) unexpectedly.
   */
  excludeRegistrationOptimized?: boolean;
  /** Caveat shown in the sheet for readers (currently only set on "All Time"). */
  note?: string;
}

/**
 * How far above `cplCap` an ad can run and still be flagged "Near" a winner rather than
 * blank. Reverse-engineered from the existing hand-built sheet: every "Near" row sat at or
 * under 1.5x its tab's CPL cap, and every blank row (that still cleared the Results floor)
 * sat well above it — so this is inferred, not a documented Wonderly rule. Confirm with
 * Emily if a borderline row ever looks mis-classified.
 */
export const NEAR_WINNER_CPL_MULTIPLIER = 1.5;

/** The four windows the sheet tracks, in the order their tabs appear. */
export const AD_WINNER_WINDOWS: AdWinnerWindow[] = [
  { tabName: 'Last 7 Days', datePreset: 'last_7d', minResults: 3, cplCap: 150 },
  { tabName: 'Last 14 Days', datePreset: 'last_14d', minResults: 5, cplCap: 150 },
  { tabName: 'Last 30 Days', datePreset: 'last_30d', minResults: 10, cplCap: 150 },
  {
    tabName: 'All Time',
    datePreset: 'maximum',
    minResults: 20,
    cplCap: 150,
    excludeRegistrationOptimized: true,
    note: 'Trial-optimized ads only; registration-optimized ads excluded for metric consistency',
  },
];

/** Column order for every Ad Winners tab. */
export const AD_WINNERS_HEADERS = [
  'AD_NAME',
  'RESULTS',
  'CPL',
  'TOTAL_SPEND',
  'STATUS',
  'WINNER',
] as const;

export type WinnerTier = 'YES' | 'Near' | '';

export interface AdWinnerRow {
  adId: string;
  adName: string;
  adLink: string;
  results: number;
  /** Cost per result, or `null` when the ad has zero results (no CPL is computable). */
  cpl: number | null;
  spend: number;
  /** Meta `effective_status` (e.g. `ACTIVE`, `PAUSED`, `CAMPAIGN_PAUSED`, `ADSET_PAUSED`). */
  status: string;
  winner: WinnerTier;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Classify an ad against one window's thresholds.
 *
 * - `'YES'` — meets both the Results floor and the CPL cap.
 * - `'Near'` — meets the Results floor but costs up to `NEAR_WINNER_CPL_MULTIPLIER`× the cap.
 * - `''` — below the Results floor, or too expensive to call close.
 *
 * @param results - The ad's Results count for the window
 * @param cpl - The ad's cost-per-result for the window, or `null` with zero results
 * @param minResults - The window's Results floor
 * @param cplCap - The window's CPL cap
 */
export function classifyWinner(
  results: number,
  cpl: number | null,
  minResults: number,
  cplCap: number
): WinnerTier {
  if (results < minResults || cpl === null) return '';
  if (cpl <= cplCap) return 'YES';
  if (cpl <= cplCap * NEAR_WINNER_CPL_MULTIPLIER) return 'Near';

  return '';
}

/**
 * Build one window's winner rows from ad-level insight rows.
 *
 * @param rows - Ad-level insight rows for the window's date preset, UNFILTERED by status —
 *   the winners sheet deliberately includes paused/campaign-paused/adset-paused ads so a
 *   strong performer that got paused for an unrelated reason doesn't just vanish
 * @param statusMap - ad ID → Meta `effective_status`, from `MetaService.getAdEffectiveStatusMap`
 * @param optimizationMap - ad set ID → Meta action type used for Results/CPL, from
 *   `MetaService.getOptimizationMap`
 * @param eventTypeMap - ad set ID → raw `promoted_object.custom_event_type`, from
 *   `MetaService.getAdSetEventTypeMap` — only consulted when `window.excludeRegistrationOptimized`
 * @param adAccountId - Ad account ID, for building each row's Ads Manager link
 * @param businessId - Meta Business Manager ID that owns the ad account (see
 *   `WONDERLY_BUSINESS_ID` in `growth-config.ts`), also for the Ads Manager link
 * @param window - The window's config (thresholds, exclusion, tab name)
 * @returns One row per ad with any activity in the window, sorted by spend descending
 */
export function computeAdWinnerRows(
  rows: MetaInsightsRow[],
  statusMap: Record<string, string>,
  optimizationMap: Record<string, string>,
  eventTypeMap: Record<string, string>,
  adAccountId: string,
  businessId: string,
  window: AdWinnerWindow
): AdWinnerRow[] {
  return rows
    .filter((row): row is MetaInsightsRow & { ad_id: string } => Boolean(row.ad_id))
    .filter((row) => {
      if (!window.excludeRegistrationOptimized) return true;

      return eventTypeMap[row.adset_id ?? ''] !== 'COMPLETE_REGISTRATION';
    })
    .map((row) => {
      const metrics = parseInsightMetrics(row, optimizationMap);
      const cpl = metrics.results > 0 ? money(metrics.cost_per_result) : null;

      return {
        adId: row.ad_id,
        adName: row.ad_name ?? row.ad_id,
        adLink: buildAdsManagerAdLink(adAccountId, businessId, row.ad_id),
        results: metrics.results,
        cpl,
        spend: money(metrics.spend),
        status: statusMap[row.ad_id] ?? '',
        winner: classifyWinner(metrics.results, cpl, window.minResults, window.cplCap),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

/** Escape a string for use inside a Sheets `HYPERLINK`/string-literal argument. */
function escapeForFormula(value: string): string {
  return value.replace(/"/g, '""');
}

/**
 * Convert winner rows to the tab's cell matrix (header row is written separately via
 * `AD_WINNERS_HEADERS`): one row per ad plus a `TOTAL` row.
 *
 * `AD_NAME` is written as a `HYPERLINK` formula (via `USER_ENTERED` input, same as the rest
 * of the sheet's writes) so each name opens straight to that ad in Meta Ads Manager. `TOTAL`
 * sums Results and Spend and derives CPL from the totals (spend ÷ results) rather than
 * averaging each row's CPL, matching the original sheet's TOTAL row.
 *
 * @param rows - Winner rows from {@link computeAdWinnerRows}
 */
export function toAdWinnerValues(rows: AdWinnerRow[]): (string | number)[][] {
  const body = rows.map((r) => [
    `=HYPERLINK("${r.adLink}", "${escapeForFormula(r.adName)}")`,
    r.results,
    r.cpl ?? '',
    r.spend,
    r.status,
    r.winner,
  ]);

  const totals = rows.reduce(
    (t, r) => ({ results: t.results + r.results, spend: t.spend + r.spend }),
    { results: 0, spend: 0 }
  );

  return [
    ...body,
    [
      'TOTAL',
      totals.results,
      totals.results > 0 ? money(totals.spend / totals.results) : '',
      money(totals.spend),
      '',
      '',
    ],
  ];
}

/**
 * Formatting for an Ad Winners tab: bold frozen header, currency on CPL/TOTAL_SPEND, a green
 * highlight on every full-winner (`WINNER = "YES"`) row, and a bold TOTAL row.
 *
 * @param sheetId - The tab's numeric gid
 * @param rowCount - Number of value rows written below the header (incl. the TOTAL row)
 */
export function buildAdWinnersFormatRequests(sheetId: number, rowCount: number): SheetsRequest[] {
  const CURRENCY = { type: 'CURRENCY', pattern: '"$"#,##0.00' };
  const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
  const WINNER_BG = { red: 0.85, green: 0.94, blue: 0.83 };
  const dataEnd = rowCount + 1; // +1 for the header row
  const totalRow = rowCount; // 0-based index of the TOTAL row (header + rowCount-1)

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
    col(2, CURRENCY), // CPL
    col(3, CURRENCY), // TOTAL_SPEND
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 1,
              endRowIndex: dataEnd,
              startColumnIndex: 0,
              endColumnIndex: AD_WINNERS_HEADERS.length,
            },
          ],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$F2="YES"' }] },
            format: { backgroundColor: WINNER_BG },
          },
        },
        index: 0,
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: totalRow, endRowIndex: totalRow + 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
  ];
}
