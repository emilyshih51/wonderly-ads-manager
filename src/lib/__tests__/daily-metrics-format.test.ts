import { describe, expect, it } from 'vitest';

import {
  buildDailyMetricsFormatRequests,
  weekBreakRows,
  type MetricFormat,
} from '@/lib/daily-metrics-format';

const METRICS: MetricFormat[] = [
  { label: 'Spend', money: true },
  { label: 'CPC', money: true },
  { label: 'Page views', money: false },
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

  it('merges one group header per metric across its four columns', () => {
    const merges = reqs.filter((r) => 'mergeCells' in r) as any[];

    expect(merges).toHaveLength(METRICS.length);
    // First metric (Spend) merges cols 1..5 (ALL, w/w, FB, Organic).
    expect(merges[0].mergeCells.range).toMatchObject({
      startColumnIndex: 1,
      endColumnIndex: 5,
      startRowIndex: 0,
      endRowIndex: 1,
    });
    // Third metric (Page views) starts at col 9.
    expect(merges[2].mergeCells.range.startColumnIndex).toBe(9);
  });

  it('adds a heat-map on every w/w column', () => {
    const rules = reqs.filter((r) => 'addConditionalFormatRule' in r) as any[];

    expect(rules).toHaveLength(METRICS.length);
    // w/w columns are 2, 6, 10.
    expect(rules.map((r) => r.addConditionalFormatRule.rule.ranges[0].startColumnIndex)).toEqual([
      2, 6, 10,
    ]);
    expect(rules[0].addConditionalFormatRule.rule.gradientRule.midpoint.value).toBe('0');
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
});
