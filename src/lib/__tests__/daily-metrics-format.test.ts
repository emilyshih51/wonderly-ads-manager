import { describe, expect, it } from 'vitest';

import { buildDailyMetricsFormatRequests, type MetricFormat } from '@/lib/daily-metrics-format';

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
