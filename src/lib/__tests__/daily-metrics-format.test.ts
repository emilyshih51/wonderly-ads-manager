import { describe, expect, it } from 'vitest';

import {
  DAILY_METRICS_FORMAT,
  buildDailyMetricsFormatRequests,
  weekBreakRows,
  type MetricFormat,
} from '@/lib/daily-metrics-format';

const METRICS: MetricFormat[] = [
  { label: 'Spend', money: true, wholeDollars: true, hideOrganic: true },
  { label: 'CPC', money: true, hideOrganic: true },
  { label: 'Page views', money: false, hasCost: true },
];

describe('buildDailyMetricsFormatRequests', () => {
  const reqs = buildDailyMetricsFormatRequests(123, METRICS);

  it('freezes the header + summary rows and the Date column', () => {
    const freeze = reqs.find((r) => 'updateSheetProperties' in r) as any;

    expect(freeze.updateSheetProperties.properties.gridProperties).toEqual({
      frozenRowCount: 5,
      frozenColumnCount: 1,
    });
  });

  it('merges each group across its variable width (Spend/CPC 4 cols, stages 5 with Cost)', () => {
    const merges = reqs.filter((r) => 'mergeCells' in r) as any[];

    expect(merges).toHaveLength(METRICS.length);
    // Spend: cols 1..5 (ALL, w/w, FB, Organic). CPC: 5..9. Page views (Cost first): 9..14.
    expect(merges[0].mergeCells.range).toMatchObject({ startColumnIndex: 1, endColumnIndex: 5 });
    expect(merges[1].mergeCells.range).toMatchObject({ startColumnIndex: 5, endColumnIndex: 9 });
    expect(merges[2].mergeCells.range).toMatchObject({ startColumnIndex: 9, endColumnIndex: 14 });
  });

  it('adds a heat-map on every w/w column', () => {
    const rules = reqs.filter((r) => 'addConditionalFormatRule' in r) as any[];

    expect(rules).toHaveLength(METRICS.length);
    // w/w cols: Spend 2, CPC 6, Page views 11 (Cost=9, ALL=10, w/w=11).
    expect(rules.map((r) => r.addConditionalFormatRule.rule.ranges[0].startColumnIndex)).toEqual([
      2, 6, 11,
    ]);
    expect(rules[0].addConditionalFormatRule.rule.gradientRule.midpoint.value).toBe('0');
  });

  it('hides Spend’s + CPC’s Organic columns and formats the Cost column as currency', () => {
    const hidden = reqs.filter(
      (r) =>
        'updateDimensionProperties' in r &&
        (r as any).updateDimensionProperties.properties?.hiddenByUser
    ) as any[];

    // Spend Organic is column 4; CPC Organic is column 8.
    const hiddenCols = hidden.map((r) => r.updateDimensionProperties.range.startIndex);

    expect(hiddenCols).toContain(4);
    expect(hiddenCols).toContain(8);

    // Page views' Cost column (9) is currency.
    const currencyAt9 = reqs.some(
      (r) =>
        'repeatCell' in r &&
        (r as any).repeatCell.range.startColumnIndex === 9 &&
        (r as any).repeatCell.cell.userEnteredFormat.numberFormat?.type === 'CURRENCY'
    );

    expect(currencyAt9).toBe(true);
  });

  it('draws a border under the last row of each week', () => {
    // Newest-first: Wed 07-22, Tue 07-21, Mon 07-20 share an ISO week (Mon 07-20);
    // Sun 07-19 is the prior week. firstRowIndex 5 → sheet rows 5,6,7,8. The week
    // changes between 07-20 (row 7) and 07-19 (row 8), so the border goes under row 7.
    const dates = ['2026-07-22', '2026-07-21', '2026-07-20', '2026-07-19'];

    expect(weekBreakRows(dates, 5)).toEqual([7]);
  });

  it('emits a border request per week break', () => {
    const withBreaks = buildDailyMetricsFormatRequests(123, METRICS, [8, 15]);
    const borders = withBreaks.filter(
      (r) => 'updateBorders' in r && (r as any).updateBorders.bottom
    );

    expect(borders).toHaveLength(2);
    expect((borders[0] as any).updateBorders.range.startRowIndex).toBe(8);
  });

  it('formats money metrics as currency and counts as plain numbers', () => {
    const numberFmts = reqs.filter(
      (r) => 'repeatCell' in r && (r as any).repeatCell.cell.userEnteredFormat.numberFormat
    ) as any[];

    const types = numberFmts.map((r) => r.repeatCell.cell.userEnteredFormat.numberFormat.type);

    // Spend ALL/FB/Organic are CURRENCY; Page views ALL/FB/Organic are NUMBER; w/w are PERCENT.
    expect(types).toContain('CURRENCY');
    expect(types).toContain('NUMBER');
    expect(types).toContain('PERCENT');
  });

  it('emits a group-header merge for every metric in the real config (incl. No show)', () => {
    const reqs = buildDailyMetricsFormatRequests(1, DAILY_METRICS_FORMAT);
    const merges = reqs
      .filter((r) => 'mergeCells' in r)
      .map(
        (r) => (r as any).mergeCells.range as { startColumnIndex: number; endColumnIndex: number }
      );

    // One merge per metric, contiguous and non-overlapping, starting at column B (index 1).
    expect(merges).toHaveLength(DAILY_METRICS_FORMAT.length);
    expect(merges[0].startColumnIndex).toBe(1);
    merges.slice(1).forEach((m, i) => expect(m.startColumnIndex).toBe(merges[i].endColumnIndex));

    // No show is 3rd (Accepted, Held, No show) and spans exactly 3 cols (ALL/FB/Organic).
    expect(merges[2]).toMatchObject({ startColumnIndex: 10, endColumnIndex: 13 });
  });

  it('shades and underlines each weekly summary row found in the values matrix', () => {
    // Header (0-1) + summaries (2-4), a daily row (5), then a "Week of …" row (6).
    const values = [
      Array(14).fill(''),
      Array(14).fill(''),
      Array(14).fill(''),
      Array(14).fill(''),
      Array(14).fill(''),
      ['2026-07-20', ...Array(13).fill('')],
      ['Week of 2026-07-20', ...Array(13).fill('')],
    ];
    const reqsWithValues = buildDailyMetricsFormatRequests(123, METRICS, [], values);

    // The weekly row (index 6) gets a background + bold repeatCell...
    const shaded = reqsWithValues.some(
      (r) =>
        'repeatCell' in r &&
        (r as any).repeatCell.range.startRowIndex === 6 &&
        (r as any).repeatCell.cell.userEnteredFormat.backgroundColor &&
        (r as any).repeatCell.cell.userEnteredFormat.textFormat?.bold === true
    );

    expect(shaded).toBe(true);

    // ...and a bottom border under it, as the block separator.
    const bordered = reqsWithValues.some(
      (r) =>
        'updateBorders' in r &&
        (r as any).updateBorders.range.startRowIndex === 6 &&
        (r as any).updateBorders.bottom
    );

    expect(bordered).toBe(true);
  });

  it('picks whole dollars vs cents per money column by its average when values are given', () => {
    // Two frozen headers + three summary rows (indices 0..4), then two daily rows.
    // Page views' Cost column is index 9. Give it a >$10 average → whole dollars.
    const bigCost = [
      Array(14).fill(''), // group header
      Array(14).fill(''), // sub header
      Array(14).fill(''), // 7d avg
      Array(14).fill(''), // MTD
      Array(14).fill(''), // Prev Month
      (() => {
        const r = Array(14).fill('');

        r[9] = 68;

        return r;
      })(),
      (() => {
        const r = Array(14).fill('');

        r[9] = 72;

        return r;
      })(),
    ];
    const wholeReqs = buildDailyMetricsFormatRequests(123, METRICS, [], bigCost);
    const costFmt = (rs: any[]) =>
      (rs.find((r) => 'repeatCell' in r && r.repeatCell.range.startColumnIndex === 9) as any)
        .repeatCell.cell.userEnteredFormat.numberFormat;

    expect(costFmt(wholeReqs)).toEqual({ type: 'CURRENCY', pattern: '"$"#,##0' });

    // Same column, but a cheap (<$10) average → keep cents.
    const cheapCost = bigCost.map((r) => [...r]);

    cheapCost[5][9] = 4;
    cheapCost[6][9] = 6;
    const centReqs = buildDailyMetricsFormatRequests(123, METRICS, [], cheapCost);

    expect(costFmt(centReqs)).toEqual({ type: 'CURRENCY', pattern: '"$"#,##0.00' });
  });
});
