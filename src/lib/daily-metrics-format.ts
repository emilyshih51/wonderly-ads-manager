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

/**
 * One metric column-group. `money` picks currency vs plain-number formatting;
 * `wholeDollars` drops the cents on a money metric (Spend); `hasCost` prepends a Cost
 * column (funnel stages); `hideOrganic` hides the empty Organic column.
 */
export interface MetricFormat {
  label: string;
  money: boolean;
  wholeDollars?: boolean;
  hasCost?: boolean;
  hideOrganic?: boolean;
  /** Hide the FB column (a metric with no channel split — its FB cells are blank). */
  hideFb?: boolean;
  /** Drop the week-over-week column (must match the same flag in `daily-metrics.ts`). */
  noWow?: boolean;
}

/**
 * Metric groups in the exact order `computeDailyMetrics` writes them. Spend/CPC are money
 * inputs (no Cost column); the funnel stages carry a Cost column. Kept here so the cron and
 * the admin formatter share one source.
 */
export const DAILY_METRICS_FORMAT: MetricFormat[] = [
  { label: 'Accepted', money: false, hasCost: true, noWow: true },
  { label: 'Held', money: false, hasCost: true },
  { label: 'No show', money: false, noWow: true },
  { label: 'Call 1 booked', money: false, hasCost: true },
  { label: 'Qualified', money: false, hasCost: true },
  { label: 'Partial', money: false, hasCost: true },
  { label: 'CTA', money: false, hasCost: true },
  { label: 'Page views', money: false, hasCost: true },
  { label: 'CPC', money: true, hideOrganic: true },
  { label: 'Spend', money: true, wholeDollars: true, hideOrganic: true },
  // Avg days from booking to the call — a plain number, no channel split, no w/w.
  { label: 'Days to call', money: false, noWow: true, hideFb: true, hideOrganic: true },
];

/** Rows frozen at the top: group header, sub-header, 7d avg, MTD, Prev Month. */
const FROZEN_ROWS = 5;

/** First data row (0-indexed): row 2 is "7d avg"; formats/heat-map start here. */
const FIRST_VALUE_ROW = 2;

const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
const HEAT_MIN = { red: 0.96, green: 0.6, blue: 0.6 }; // negative w/w → red
const HEAT_MID = { red: 1, green: 1, blue: 1 }; // flat → white
const HEAT_MAX = { red: 0.6, green: 0.85, blue: 0.6 }; // positive w/w → green
const WEEK_LINE = { red: 0.45, green: 0.45, blue: 0.45 }; // week-separator border
const WEEK_ROW_BG = { red: 0.9, green: 0.93, blue: 0.9 }; // weekly-summary row shading
const WHITE = { red: 1, green: 1, blue: 1 }; // reset shading on non-weekly rows

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
const CURRENCY_WHOLE = { type: 'CURRENCY', pattern: '"$"#,##0' };
const COUNT = { type: 'NUMBER', pattern: '#,##0' };
const COUNT_DECIMAL = { type: 'NUMBER', pattern: '#,##0.0' };
const PERCENT = { type: 'PERCENT', pattern: '0.0%' };

/** Sheet row index (0-based) of the 7d-average summary row — its counts are fractional. */
const SEVEN_DAY_ROW = 2;

/**
 * Money columns show whole dollars when they typically run above this, else cents — so
 * big figures (spend, cost per accepted) drop the noise while small ones (CPC, cheap
 * per-stage costs) keep their precision.
 */
const WHOLE_DOLLAR_THRESHOLD = 10;

/** Parse a cell to a finite number (stripping `$`, commas, `%`); null if not numeric. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;

  const n = parseFloat(v.replace(/[^0-9.-]/g, ''));

  return Number.isFinite(n) ? n : null;
}

/** Mean of a column's daily rows (skips the header + summary rows); null if none numeric. */
function columnMean(values: (string | number)[][] | undefined, col: number): number | null {
  if (!values) return null;

  const nums: number[] = [];

  for (let r = FROZEN_ROWS; r < values.length; r++) {
    const n = toNumber(values[r]?.[col]);

    if (n !== null) nums.push(n);
  }

  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/**
 * Pick a currency format for a money column by its typical magnitude: whole dollars when
 * the column averages above $10, cents otherwise. Falls back to `fallbackWhole` when there
 * are no data rows to average (e.g. the one-off admin formatter runs before values exist).
 */
function moneyFormat(
  values: (string | number)[][] | undefined,
  col: number,
  fallbackWhole: boolean
): { type: string; pattern: string } {
  const mean = columnMean(values, col);

  if (mean === null) return fallbackWhole ? CURRENCY_WHOLE : CURRENCY;

  return mean > WHOLE_DOLLAR_THRESHOLD ? CURRENCY_WHOLE : CURRENCY;
}

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
 * @param values - The full Daily Metrics matrix (header + summary + daily rows) the cron just
 *   wrote. Used to pick whole-dollar vs cents per money column by its average; omit and every
 *   money column falls back to its static default.
 * @returns Ordered `batchUpdate` requests: freeze, header styling, then per-metric merge,
 *   number formats, the week-over-week heat-map rule, and week-separator borders
 */
export function buildDailyMetricsFormatRequests(
  sheetId: number,
  metrics: MetricFormat[],
  weekBreaks: number[] = [],
  values?: (string | number)[][]
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

  // Date column (A): show the weekday alongside the date (e.g. "Wed 2026-07-30"). The cell
  // stays a real date — only the display changes — so the summary rows' SUMIFS date
  // criteria keep working. Text labels in the summary rows are unaffected by a date format.
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: FROZEN_ROWS, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'ddd yyyy-mm-dd' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });

  // Total columns: Date + each group's width. Base is 4 (ALL · w/w · FB · Organic); a Cost
  // column adds one, and a `noWow` metric drops one.
  const lastColumn =
    1 + metrics.reduce((n, m) => n + 4 + (m.hasCost ? 1 : 0) - (m.noWow ? 1 : 0), 0);

  // Un-hide every data column first, so a column-order change can't leave a previously
  // hidden column stuck hidden (the per-metric `hideOrganic` below re-hides the right ones).
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: lastColumn },
      properties: { hiddenByUser: false },
      fields: 'hiddenByUser',
    },
  });

  // Variable-width groups: funnel stages prepend a Cost column (Cost · ALL · w/w · FB ·
  // Organic); Spend/CPC have no Cost (ALL · w/w · FB · Organic).
  let colIdx = 1;

  metrics.forEach((m) => {
    const groupStart = colIdx;
    const cost = m.hasCost ? colIdx++ : undefined;
    const all = colIdx++;
    const wow = m.noWow ? undefined : colIdx++;
    const fb = colIdx++;
    const organic = colIdx++;

    // Merge the metric name across its whole group in the group-header row.
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: groupStart,
          endColumnIndex: colIdx,
        },
        mergeType: 'MERGE_ALL',
      },
    });

    // Cost (per action) is dollars — whole above $10, cents below (per its column average).
    if (cost !== undefined) {
      requests.push({
        repeatCell: {
          range: column(sheetId, cost),
          cell: { userEnteredFormat: { numberFormat: moneyFormat(values, cost, true) } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    }

    // ALL / FB / Organic take the value format; w/w is a percent. Money columns choose
    // whole-dollars vs cents by their own average; counts are plain integers.
    for (const col of [all, fb, organic]) {
      const valueFormat = m.money ? moneyFormat(values, col, m.wholeDollars ?? false) : COUNT;

      requests.push({
        repeatCell: {
          range: column(sheetId, col),
          cell: { userEnteredFormat: { numberFormat: valueFormat } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });

      // The 7d-average of a count is fractional (e.g. 0.6 held) — show one decimal on
      // that one cell so it (and its FB/Organic split) doesn't round away to 0.
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

    // w/w column: percent format + a −50% red → 0 white → +50% green heat-map. Skipped
    // entirely for `noWow` metrics (e.g. Accepted), which have no w/w column.
    if (wow !== undefined) {
      requests.push({
        repeatCell: {
          range: column(sheetId, wow),
          cell: { userEnteredFormat: { numberFormat: PERCENT } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });

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
    }

    // Hide channel columns that carry no data (CPC — no organic ad spend; No show — no
    // channel split at all, so both FB and Organic are hidden).
    if (m.hideFb) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: fb, endIndex: fb + 1 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      });
    }

    if (m.hideOrganic) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: organic, endIndex: organic + 1 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      });
    }
  });

  // Tighten the grid: narrow the metric columns (short numbers) and keep the Date column
  // wide enough for the weekday prefix ("Wed 2026-07-30").
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 104 },
      fields: 'pixelSize',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: lastColumn },
      properties: { pixelSize: 62 },
      fields: 'pixelSize',
    },
  });

  // Weekly summary rows: when the values matrix is supplied, find each "Week of …" row
  // (bottom of its 7-day block), shade + bold it, and put the block-separator border under
  // it. Falling back to the passed-in `weekBreaks` keeps the one-off formatter working when
  // no values are handed in.
  const weeklyRowIndices = values
    ? values.reduce<number[]>((acc, row, i) => {
        if (i >= FROZEN_ROWS && String(row[0] ?? '').startsWith('Week of')) acc.push(i);

        return acc;
      }, [])
    : [];

  // Reset shading + bold across the whole data block first. Rows shift down by one each day
  // as a new row is added at the top, so a prior run's weekly-row green would otherwise
  // linger on what is now a daily row — leaving two green rows. Clear, then re-shade the
  // current weekly rows below. (Only backgroundColor/bold are touched; number formats stay.)
  if (weeklyRowIndices.length > 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: FROZEN_ROWS,
          endRowIndex: FROZEN_ROWS + BORDER_CLEAR_ROWS,
          startColumnIndex: 0,
          endColumnIndex: lastColumn,
        },
        cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
      },
    });
  }

  for (const rowIndex of weeklyRowIndices) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 0,
          endColumnIndex: lastColumn,
        },
        cell: { userEnteredFormat: { backgroundColor: WEEK_ROW_BG, textFormat: { bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
      },
    });
  }

  // Week-separator borders. Rows shift down as new days arrive, so clear the block's inner
  // borders first, then draw a line under each week (the weekly summary row, or the passed
  // week-break rows when no values are supplied).
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

  const borderRows = weeklyRowIndices.length > 0 ? weeklyRowIndices : weekBreaks;

  for (const rowIndex of borderRows) {
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
