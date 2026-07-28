import { describe, expect, it } from 'vitest';

import { buildOverviewFormatRequests } from '@/lib/overview-format';

/** A trimmed Overview matrix with the sections the formatter keys off. */
const MATRIX: (string | number)[][] = [
  ['Wonderly Growth — Overview'],
  ['Last refreshed (PT)', 'Jul 28, 2026, 3:48 PM'],
  ['Data through', '2026-07-28'],
  [],
  ['HEADLINE COST — last 7 days'],
  ['Cost per confirmed Call 1', 402],
  ['Cost per accepted contractor', 17907],
  ['', 'Succeeding = cumulative PNL > 0 within the window of ad go-live.'],
  [],
  ['WARNINGS'],
  ['✓ Data current through 2026-07-28'],
  [],
  ['SEVEN DAYS vs PREVIOUS SEVEN DAYS'],
  [
    'STEP',
    'THIS_7D',
    'PREV_7D',
    'CHANGE',
    'PCT_CHANGE',
    'CONVERSION',
    'COST_PER_RESULT',
    'COST_PCT_CHANGE',
  ],
  ['FB_SPEND', 35815, 35234, 581, 0.0165, '', '', ''],
  ['CALL1_BOOKED', 89, 117, -28, -0.239, 0.87, 402, 0.336],
];

describe('buildOverviewFormatRequests', () => {
  const reqs = buildOverviewFormatRequests(7, MATRIX);

  it('bolds and shades each section band', () => {
    const shaded = reqs.filter(
      (r) => 'repeatCell' in r && (r as any).repeatCell.cell.userEnteredFormat.backgroundColor
    ) as any[];

    // Reset (white) + 3 section bands + w/w header = at least 5 background writes.
    expect(shaded.length).toBeGreaterThanOrEqual(5);
  });

  it('currency-formats the cost rows', () => {
    const currency = reqs.filter(
      (r) =>
        'repeatCell' in r &&
        (r as any).repeatCell.cell.userEnteredFormat.numberFormat?.type === 'CURRENCY'
    );

    expect(currency.length).toBeGreaterThanOrEqual(2);
  });

  it('percent-formats the rate columns of the w/w table and heat-maps PCT_CHANGE', () => {
    const percent = reqs.filter(
      (r) =>
        'repeatCell' in r &&
        (r as any).repeatCell.cell.userEnteredFormat.numberFormat?.type === 'PERCENT'
    );

    expect(percent.length).toBeGreaterThanOrEqual(3);

    const heat = reqs.filter((r) => 'addConditionalFormatRule' in r) as any[];

    expect(heat).toHaveLength(1);
    expect(heat[0].addConditionalFormatRule.rule.ranges[0].startColumnIndex).toBe(4);
  });
});
