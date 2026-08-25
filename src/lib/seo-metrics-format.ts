/**
 * SEO Metrics formatting — the Sheets `batchUpdate` requests that make the SEO grid read
 * like Daily Metrics: frozen header + summary rows, merged group headers, a number format
 * per column, a red→white→green heat-map on the week-over-week columns, and shaded,
 * bordered weekly summary rows.
 *
 * Deliberately a sibling of `daily-metrics-format` rather than a reuse of it: that module's
 * column vocabulary is hard-wired to Cost/ALL/w-w/FB/Organic, and this tab's groups are
 * Conv/SEO/w-w/ALL/SEO-share — three of the five slots want different number formats. Bending
 * the shared builder into taking both shapes would cost more clarity than the duplication does.
 *
 * Formatting is orthogonal to values: the cron rewrites only cell values (clear + PUT), so
 * merges, frozen panes, number formats and conditional rules survive every refresh. It is
 * re-applied each run anyway, which keeps the layout in step when columns change.
 *
 * Pure (takes the tab's gid, returns request objects) so the layout math is unit tested
 * without touching the Sheets API.
 */

import type { SheetsRequest } from '@/lib/daily-metrics-format';

/** One metric column-group, in the order `computeSeoMetrics` writes them. */
export interface SeoMetricFormat {
  label: string;
  /** Group carries a leading Conv column (every stage except the top of funnel). */
  hasConv: boolean;
  /** Group drops its week-over-week column (must match the same flag in `seo-metrics.ts`). */
  noWow: boolean;
}

/** Rows frozen at the top: group header, sub-header, 7d avg, MTD, Prev Month. */
const FROZEN_ROWS = 5;

/** First formatted row (0-indexed): row 2 is "7d avg". */
const FIRST_VALUE_ROW = 2;

/** Sheet row index (0-based) of the 7d-average row — its counts are fractional. */
const SEVEN_DAY_ROW = 2;

/** Rows cleared of stale shading/borders before redrawing (well past any real data). */
const BORDER_CLEAR_ROWS = 500;

const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
const HEAT_MIN = { red: 0.96, green: 0.6, blue: 0.6 };
const HEAT_MID = { red: 1, green: 1, blue: 1 };
const HEAT_MAX = { red: 0.6, green: 0.85, blue: 0.6 };
const WEEK_LINE = { red: 0.45, green: 0.45, blue: 0.45 };
const WEEK_ROW_BG = { red: 0.9, green: 0.93, blue: 0.9 };
const WHITE = { red: 1, green: 1, blue: 1 };
/** SEO columns get a faint tint so the channel reads as this tab's subject. */
const SEO_COL_BG = { red: 0.95, green: 0.97, blue: 1 };

const COUNT = { type: 'NUMBER', pattern: '#,##0' };
const COUNT_DECIMAL = { type: 'NUMBER', pattern: '#,##0.0' };
const PERCENT = { type: 'PERCENT', pattern: '0.0%' };

/** A column range, open-ended downward so new daily rows inherit the format. */
function column(sheetId: number, col: number, startRow = FIRST_VALUE_ROW): SheetsRequest {
  return { sheetId, startRowIndex: startRow, startColumnIndex: col, endColumnIndex: col + 1 };
}

function numberFormat(sheetId: number, col: number, fmt: Record<string, string>): SheetsRequest {
  return {
    repeatCell: {
      range: column(sheetId, col),
      cell: { userEnteredFormat: { numberFormat: fmt } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

/**
 * Build the full set of formatting requests for the SEO Metrics tab.
 *
 * @param sheetId - The tab's numeric gid
 * @param metrics - Metric groups in column order (from `SEO_METRICS_LABELS`)
 * @param values - The matrix the cron just wrote; used to find the "Week of …" rows to
 *   shade and border. Omit and the weekly styling is skipped.
 * @returns Ordered `batchUpdate` requests
 */
export function buildSeoMetricsFormatRequests(
  sheetId: number,
  metrics: SeoMetricFormat[],
  values?: (string | number)[][]
): SheetsRequest[] {
  const requests: SheetsRequest[] = [
    // Unmerge first so a re-run can't fail on an already-merged range (no-op when clean).
    { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 } } },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: FROZEN_ROWS, frozenColumnCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    },
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
    // Date column: show the weekday alongside the date. The cell stays a real date — only
    // the display changes — so the summary rows' SUMIFS date criteria keep working.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: FROZEN_ROWS, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'ddd yyyy-mm-dd' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ];

  // Group width: SEO · ALL · SEO share = 3, plus Conv and w/w when present.
  const lastColumn =
    1 + metrics.reduce((n, m) => n + 3 + (m.hasConv ? 1 : 0) + (m.noWow ? 0 : 1), 0);

  let colIdx = 1;

  metrics.forEach((m) => {
    const groupStart = colIdx;
    const conv = m.hasConv ? colIdx++ : undefined;
    const seo = colIdx++;
    const wow = m.noWow ? undefined : colIdx++;
    const all = colIdx++;
    const share = colIdx++;

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

    if (conv !== undefined) requests.push(numberFormat(sheetId, conv, PERCENT));

    requests.push(numberFormat(sheetId, seo, COUNT));
    requests.push(numberFormat(sheetId, all, COUNT));
    requests.push(numberFormat(sheetId, share, PERCENT));

    // The 7d average of a count is fractional (e.g. 0.4 accepted) — one decimal on that
    // row only, so organic's small numbers don't round away to 0.
    for (const col of [seo, all]) {
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

    if (wow !== undefined) {
      requests.push(numberFormat(sheetId, wow, PERCENT));
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
  });

  // Column widths: Date wide enough for the weekday prefix, metrics narrow.
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

  // Weekly summary rows shift down by one each day as a new row lands on top, so a prior
  // run's green would linger on what is now a daily row. Clear shading across the block
  // first, then re-shade the current weekly rows. Only background/bold are touched — the
  // per-column number formats above survive.
  const weeklyRowIndices = values
    ? values.reduce<number[]>((acc, row, i) => {
        if (i >= FROZEN_ROWS && String(row[0] ?? '').startsWith('Week of')) acc.push(i);

        return acc;
      }, [])
    : [];

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

    // Re-tint the SEO count columns after the clear, so the tab's subject stays legible.
    let tintIdx = 1;

    for (const m of metrics) {
      if (m.hasConv) tintIdx++;

      const seoCol = tintIdx++;

      if (!m.noWow) tintIdx++;
      tintIdx += 2; // ALL, SEO share

      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: FROZEN_ROWS,
            endRowIndex: FROZEN_ROWS + BORDER_CLEAR_ROWS,
            startColumnIndex: seoCol,
            endColumnIndex: seoCol + 1,
          },
          cell: { userEnteredFormat: { backgroundColor: SEO_COL_BG } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }
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

  // Week-separator borders: clear the block's inner borders (rows shift as days arrive),
  // then draw a line under each weekly summary row.
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

  for (const rowIndex of weeklyRowIndices) {
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
