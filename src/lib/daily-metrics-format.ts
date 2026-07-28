/**
 * Daily Metrics formatting — builds the Sheets `batchUpdate` requests that make the
 * Motion-style grid readable: frozen header + summary rows, merged group headers, a
 * currency/number/percent format per column, and a red→white→green heat-map on every
 * week-over-week column.
 *
 * Formatting is a one-time apply. The cron rewrites only *values* (clear + PUT), so
 * cell formats, merges, frozen panes, and conditional-format rules all survive every
 * refresh — which is why this lives outside the cron and is triggered on demand.
 *
 * Pure (takes the sheet's gid, returns request objects) so the layout math is unit
 * tested without touching the Sheets API.
 */

/** A Sheets API `batchUpdate` request. Loosely typed — the shapes are the API's, not ours. */
export type SheetsRequest = Record<string, unknown>;

/** One metric column-group. `money` picks currency vs plain-number formatting for its values. */
export interface MetricFormat {
  label: string;
  money: boolean;
}

/**
 * Metric groups in the exact order `computeDailyMetrics` writes them. Spend and CPC are
 * money; the rest are counts. Kept here so the cron and the admin formatter share one source.
 */
export const DAILY_METRICS_FORMAT: MetricFormat[] = [
  { label: 'Spend', money: true },
  { label: 'CPC', money: true },
  { label: 'Page views', money: false },
  { label: 'CTA', money: false },
  { label: 'Partial', money: false },
  { label: 'Qualified', money: false },
  { label: 'Call 1 booked', money: false },
  { label: 'Held', money: false },
  { label: 'Accepted', money: false },
];

/** Columns per metric group in the grid: ALL, w/w, FB, Organic. */
const COLS_PER_METRIC = 4;

/** Rows frozen at the top: group header, sub-header, 7d avg, MTD, Prev Month. */
const FROZEN_ROWS = 5;

/** First data row (0-indexed): row 2 is "7d avg"; formats/heat-map start here. */
const FIRST_VALUE_ROW = 2;

const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
const HEAT_MIN = { red: 0.96, green: 0.6, blue: 0.6 }; // negative w/w → red
const HEAT_MID = { red: 1, green: 1, blue: 1 }; // flat → white
const HEAT_MAX = { red: 0.6, green: 0.85, blue: 0.6 }; // positive w/w → green

const CURRENCY = { type: 'CURRENCY', pattern: '"$"#,##0.00' };
const COUNT = { type: 'NUMBER', pattern: '#,##0' };
const PERCENT = { type: 'PERCENT', pattern: '0.0%' };

/** A column range on the sheet, open-ended downward so new daily rows inherit the format. */
function column(sheetId: number, col: number, startRow = FIRST_VALUE_ROW): SheetsRequest {
  return { sheetId, startRowIndex: startRow, startColumnIndex: col, endColumnIndex: col + 1 };
}

/**
 * Build the full set of formatting requests for the Daily Metrics tab.
 *
 * @param sheetId - The tab's numeric gid
 * @param metrics - Metric groups in column order (their `money` flag drives value formatting)
 * @returns Ordered `batchUpdate` requests: freeze, header styling, then per-metric merge,
 *   number formats, and the week-over-week heat-map rule
 */
export function buildDailyMetricsFormatRequests(
  sheetId: number,
  metrics: MetricFormat[]
): SheetsRequest[] {
  const requests: SheetsRequest[] = [
    // Unmerge the group-header row first so re-running (e.g. every cron) can't fail on
    // an already-merged range. Unmerging a non-merged range is a no-op.
    { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 } } },
    // Freeze the two header rows + three summary rows, and the Date column.
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: FROZEN_ROWS, frozenColumnCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    },
    // Group + sub-header rows: bold, centered, shaded.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            backgroundColor: HEADER_BG,
          },
        },
        fields:
          'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,backgroundColor)',
      },
    },
    // Summary row labels (7d avg / MTD / Prev Month) bold.
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 2,
          endRowIndex: 5,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
  ];

  metrics.forEach((m, g) => {
    const all = 1 + g * COLS_PER_METRIC;
    const wow = all + 1;
    const fb = all + 2;
    const organic = all + 3;
    const valueFormat = m.money ? CURRENCY : COUNT;

    // Merge the metric name across its four columns in the group-header row.
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: all,
          endColumnIndex: all + COLS_PER_METRIC,
        },
        mergeType: 'MERGE_ALL',
      },
    });

    // ALL / FB / Organic take the value format; w/w is a percent.
    for (const col of [all, fb, organic]) {
      requests.push({
        repeatCell: {
          range: column(sheetId, col),
          cell: { userEnteredFormat: { numberFormat: valueFormat } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    }

    requests.push({
      repeatCell: {
        range: column(sheetId, wow),
        cell: { userEnteredFormat: { numberFormat: PERCENT } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });

    // Heat-map the w/w column: −50% red → 0 white → +50% green.
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [column(sheetId, wow)],
          gradientRule: {
            minpoint: { color: HEAT_MIN, type: 'NUMBER', value: '-0.5' },
            midpoint: { color: HEAT_MID, type: 'NUMBER', value: '0' },
            maxpoint: { color: HEAT_MAX, type: 'NUMBER', value: '0.5' },
          },
        },
      },
    });
  });

  return requests;
}
