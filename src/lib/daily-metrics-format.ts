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
  { label: 'Cost/visit', money: true },
  { label: 'Cost/CTA', money: true },
  { label: 'Cost/partial', money: true },
  { label: 'Cost/qualified', money: true },
  { label: 'Cost/Call 1', money: true },
  { label: 'Cost/held', money: true },
  { label: 'Cost/accepted', money: true },
];

/** Columns per metric group in the grid: ALL, w/w, FB, Organic. */
/** ALL, w/w, FB, Google, Yahoo, Bing, N/A. */
const COLS_PER_METRIC = 7;

/** Rows frozen at the top: group header, sub-header, 7d avg, MTD, Prev Month. */
const FROZEN_ROWS = 5;

/** First data row (0-indexed): row 2 is "7d avg"; formats/heat-map start here. */
const FIRST_VALUE_ROW = 2;

const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
const HEAT_MIN = { red: 0.96, green: 0.6, blue: 0.6 }; // negative w/w → red
const HEAT_MID = { red: 1, green: 1, blue: 1 }; // flat → white
const HEAT_MAX = { red: 0.6, green: 0.85, blue: 0.6 }; // positive w/w → green
const WEEK_LINE = { red: 0.45, green: 0.45, blue: 0.45 }; // week-separator border

/** Rows cleared of stale inner borders before redrawing (well past any real data). */
const BORDER_CLEAR_ROWS = 500;

/** Monday (UTC) of a date's week, as a stable weekly key. */
function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;

  d.setUTCDate(d.getUTCDate() - daysSinceMonday);

  return d.toISOString().slice(0, 10);
}

/**
 * 0-based sheet row indices that end a week — the last (oldest) row before the week
 * changes — so the daily grid can be grouped with a border under each week.
 *
 * @param dates - Daily row dates, newest first (the sheet's order)
 * @param firstRowIndex - 0-based sheet row of the first daily row (data starts at row 6 → 5)
 */
export function weekBreakRows(dates: string[], firstRowIndex: number): number[] {
  const breaks: number[] = [];

  for (let i = 0; i < dates.length - 1; i++) {
    if (weekKey(dates[i]) !== weekKey(dates[i + 1])) breaks.push(firstRowIndex + i);
  }

  return breaks;
}

const CURRENCY = { type: 'CURRENCY', pattern: '"$"#,##0.00' };
const COUNT = { type: 'NUMBER', pattern: '#,##0' };
const COUNT_DECIMAL = { type: 'NUMBER', pattern: '#,##0.0' };
const PERCENT = { type: 'PERCENT', pattern: '0.0%' };

/** Sheet row index (0-based) of the 7d-average summary row — its counts are fractional. */
const SEVEN_DAY_ROW = 2;

/** A column range on the sheet, open-ended downward so new daily rows inherit the format. */
function column(sheetId: number, col: number, startRow = FIRST_VALUE_ROW): SheetsRequest {
  return { sheetId, startRowIndex: startRow, startColumnIndex: col, endColumnIndex: col + 1 };
}

/**
 * Build the full set of formatting requests for the Daily Metrics tab.
 *
 * @param sheetId - The tab's numeric gid
 * @param metrics - Metric groups in column order (their `money` flag drives value formatting)
 * @param weekBreaks - 0-based sheet rows to get a bottom border (from `weekBreakRows`)
 * @returns Ordered `batchUpdate` requests: freeze, header styling, then per-metric merge,
 *   number formats, the week-over-week heat-map rule, and week-separator borders
 */
export function buildDailyMetricsFormatRequests(
  sheetId: number,
  metrics: MetricFormat[],
  weekBreaks: number[] = []
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
    // Value columns: ALL plus the five source columns (FB, Google, Yahoo, Bing, N/A).
    const valueCols = [all, all + 2, all + 3, all + 4, all + 5, all + 6];
    const valueFormat = m.money ? CURRENCY : COUNT;

    // Merge the metric name across its seven columns in the group-header row.
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

    // ALL and each source column take the value format; w/w is a percent.
    for (const col of valueCols) {
      requests.push({
        repeatCell: {
          range: column(sheetId, col),
          cell: { userEnteredFormat: { numberFormat: valueFormat } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });

      // The 7d-average of a count is fractional (e.g. 0.6 held) — show one decimal on
      // that one cell so it (and its FB/Organic split) doesn't round away to 0. Money
      // metrics already show cents via their currency format.
      if (!m.money) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: SEVEN_DAY_ROW,
              endRowIndex: SEVEN_DAY_ROW + 1,
              startColumnIndex: col,
              endColumnIndex: col + 1,
            },
            cell: { userEnteredFormat: { numberFormat: COUNT_DECIMAL } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }
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

    // Facebook-only metrics (Spend, CPC) have no Google/Yahoo/Bing/N-A data — hide those
    // four columns so the grid isn't padded with empty channels.
    if (m.money) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: all + 3, endIndex: all + 7 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      });
    }
  });

  // Week-separator borders. Rows shift down as new days arrive, so clear the daily
  // block's inner borders first, then draw a line under the last row of each week.
  const lastColumn = 1 + metrics.length * COLS_PER_METRIC;

  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: FROZEN_ROWS,
        endRowIndex: FROZEN_ROWS + BORDER_CLEAR_ROWS,
        startColumnIndex: 0,
        endColumnIndex: lastColumn,
      },
      innerHorizontal: { style: 'NONE' },
    },
  });

  for (const rowIndex of weekBreaks) {
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 0,
          endColumnIndex: lastColumn,
        },
        bottom: { style: 'SOLID_MEDIUM', color: WEEK_LINE },
      },
    });
  }

  return requests;
}
