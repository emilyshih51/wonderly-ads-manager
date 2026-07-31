/**
 * Overview formatting — builds the Sheets `batchUpdate` requests that make the KPI
 * dashboard readable: a bold title, shaded section bands, currency on the cost rows,
 * a formatted week-over-week table (percent / currency columns + a heat-map), and
 * sensible column widths.
 *
 * Driven off the Overview matrix itself (it finds sections and the w/w table by their
 * labels) so it stays correct if rows shift. Applied on every cron run — formatting is
 * orthogonal to values, so it persists. Pure, so the layout logic is unit tested.
 */

import type { SheetsRequest } from '@/lib/daily-metrics-format';

const WIDTH = 8; // columns the dashboard spans (A..H)

const SECTION_BG = { red: 0.87, green: 0.9, blue: 0.94 };
const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
const WHITE = { red: 1, green: 1, blue: 1 };
const NOTE_COLOR = { red: 0.45, green: 0.45, blue: 0.45 };
const HEAT_MIN = { red: 0.96, green: 0.6, blue: 0.6 };
const HEAT_MID = { red: 1, green: 1, blue: 1 };
const HEAT_MAX = { red: 0.6, green: 0.85, blue: 0.6 };

const CURRENCY = { type: 'CURRENCY', pattern: '"$"#,##0.00' };
const PERCENT = { type: 'PERCENT', pattern: '0.0%' };
// Plain integer with thousands separators — no decimal point, so counts don't show a
// stray trailing dot. (Spend cents are kept via a currency override on the FB_SPEND row.)
const NUMBER = { type: 'NUMBER', pattern: '#,##0' };

/** True for a section-band header row (HEADLINE COST… matched by prefix, others exact). */
function isSectionLabel(label: string): boolean {
  return (
    label.startsWith('HEADLINE COST') ||
    label === 'WARNINGS' ||
    label === 'SEVEN DAYS vs PREVIOUS SEVEN DAYS'
  );
}

/** Column indices inside the week-over-week table. */
const WOW = { pctChange: 4, conversion: 5, costPerResult: 6, costPctChange: 7 };

function rowRange(sheetId: number, rowIndex: number, endCol = WIDTH) {
  return {
    sheetId,
    startRowIndex: rowIndex,
    endRowIndex: rowIndex + 1,
    startColumnIndex: 0,
    endColumnIndex: endCol,
  };
}

function cellRange(sheetId: number, rowIndex: number, col: number) {
  return {
    sheetId,
    startRowIndex: rowIndex,
    endRowIndex: rowIndex + 1,
    startColumnIndex: col,
    endColumnIndex: col + 1,
  };
}

/**
 * Build the formatting requests for the Overview tab.
 *
 * @param sheetId - The tab's numeric gid
 * @param matrix - The Overview matrix the cron just wrote (used to locate sections)
 */
export function buildOverviewFormatRequests(
  sheetId: number,
  matrix: (string | number)[][]
): SheetsRequest[] {
  const rowCount = matrix.length;
  const requests: SheetsRequest[] = [
    // Reset backgrounds + bolding across the block first, so old manual bands don't linger.
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: WIDTH,
        },
        cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
      },
    },
    // Title row: bold + larger.
    {
      repeatCell: {
        range: rowRange(sheetId, 0),
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
  ];

  let wowHeader = -1;

  matrix.forEach((row, i) => {
    const label = String(row[0] ?? '');

    if (isSectionLabel(label)) {
      requests.push({
        repeatCell: {
          range: rowRange(sheetId, i),
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: SECTION_BG } },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      });
    }

    if (
      label.startsWith('Cost per') ||
      label.startsWith('Last refreshed') ||
      label === 'Data through'
    ) {
      // Bold the label so the headline block reads as a list.
      requests.push({
        repeatCell: {
          range: cellRange(sheetId, i, 0),
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }

    if (label.startsWith('Cost per')) {
      requests.push({
        repeatCell: {
          range: cellRange(sheetId, i, 1),
          cell: { userEnteredFormat: { numberFormat: CURRENCY } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    }

    // The succeeding-contractor caveat note: italic, muted.
    if (label === '' && String(row[1] ?? '').startsWith('Succeeding =')) {
      requests.push({
        repeatCell: {
          range: cellRange(sheetId, i, 1),
          cell: {
            userEnteredFormat: { textFormat: { italic: true, foregroundColor: NOTE_COLOR } },
          },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }

    if (label === 'STEP') wowHeader = i;
  });

  if (wowHeader >= 0) {
    const firstData = wowHeader + 1;
    const numberFmt = (col: number, fmt: Record<string, string>) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: firstData,
          endRowIndex: rowCount,
          startColumnIndex: col,
          endColumnIndex: col + 1,
        },
        cell: { userEnteredFormat: { numberFormat: fmt } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });

    // Header row: bold + shaded.
    requests.push({
      repeatCell: {
        range: rowRange(sheetId, wowHeader),
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_BG } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    });

    // THIS_7D / PREV_7D / CHANGE are counts → plain integers, no trailing dot.
    requests.push(numberFmt(1, NUMBER), numberFmt(2, NUMBER), numberFmt(3, NUMBER));

    // The FB_SPEND row is dollars — keep cents on its THIS_7D / PREV_7D / CHANGE cells.
    const spendRow = matrix.findIndex((r) => String(r[0]) === 'FB_SPEND');

    if (spendRow >= 0) {
      for (const col of [1, 2, 3]) {
        requests.push({
          repeatCell: {
            range: cellRange(sheetId, spendRow, col),
            cell: { userEnteredFormat: { numberFormat: CURRENCY } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }
    }

    // Rates as percent, cost per result as currency.
    requests.push(numberFmt(WOW.pctChange, PERCENT));
    requests.push(numberFmt(WOW.conversion, PERCENT));
    requests.push(numberFmt(WOW.costPctChange, PERCENT));
    requests.push(numberFmt(WOW.costPerResult, CURRENCY));

    // Heat-map the week-over-week % change.
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: firstData,
              endRowIndex: rowCount,
              startColumnIndex: WOW.pctChange,
              endColumnIndex: WOW.pctChange + 1,
            },
          ],
          gradientRule: {
            minpoint: { color: HEAT_MIN, type: 'NUMBER', value: '-0.5' },
            midpoint: { color: HEAT_MID, type: 'NUMBER', value: '0' },
            maxpoint: { color: HEAT_MAX, type: 'NUMBER', value: '0.5' },
          },
        },
      },
    });
  }

  // Wider label column, and a value column that fits the currency.
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 280 },
      fields: 'pixelSize',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 150 },
      fields: 'pixelSize',
    },
  });

  // Freeze the title row.
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  return requests;
}
