import { describe, expect, it } from 'vitest';

import { WEEK_OVER_WEEK_HEADERS, computeWeekOverWeek } from '@/lib/week-over-week';
import type { MarketingDailyRow } from '@/lib/marketing-daily';

function row(o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date: '2026-07-27',
    pageView: 0,
    pageViewFb: 0,
    pageViewOrganic: 0,
    ctaClicked: 0,
    ctaFb: 0,
    ctaOrganic: 0,
    submitPartial: 0,
    submitPartialFb: 0,
    submitPartialOrganic: 0,
    submitQualified: 0,
    submitQualifiedFb: 0,
    submitQualifiedOrganic: 0,
    bookedAll: 0,
    bookedFb: 0,
    bookedOrganic: 0,
    accepted: 0,
    acceptedFb: 0,
    acceptedOrganic: 0,
    noShow: 0,
    disqualifiedLost: 0,
    held: 0,
    heldFb: 0,
    heldOrganic: 0,
    fbSpend: 0,
    fbImpressions: 0,
    fbClicks: 0,
    ...o,
  };
}

/** { STEP: { header: value } } for readable assertions. */
function byStep(matrix: (string | number)[][]): Record<string, Record<string, string | number>> {
  const out: Record<string, Record<string, string | number>> = {};

  for (const r of matrix) {
    out[String(r[0])] = Object.fromEntries(WEEK_OVER_WEEK_HEADERS.map((h, i) => [h, r[i]]));
  }

  return out;
}

/** 7 identical "this week" rows then 7 identical "previous week" rows. */
function twoWeeks(thisWk: Partial<MarketingDailyRow>, prevWk: Partial<MarketingDailyRow>) {
  return [
    ...Array(7)
      .fill(0)
      .map(() => row(thisWk)),
    ...Array(7)
      .fill(0)
      .map(() => row(prevWk)),
  ];
}

describe('computeWeekOverWeek', () => {
  it('sums each 7-day window and computes the change', () => {
    const s = byStep(computeWeekOverWeek(twoWeeks({ bookedAll: 2 }, { bookedAll: 1 })));

    expect(s.CALL1_BOOKED.THIS_7D).toBe(14); // 2 * 7
    expect(s.CALL1_BOOKED.PREV_7D).toBe(7); // 1 * 7
    expect(s.CALL1_BOOKED.CHANGE).toBe(7);
    expect(s.CALL1_BOOKED.PCT_CHANGE).toBe(1); // +100%
  });

  it('rates conversion on summed numerator / denominator', () => {
    const s = byStep(
      computeWeekOverWeek(
        twoWeeks({ submitQualified: 10, bookedAll: 4 }, { submitQualified: 10, bookedAll: 2 })
      )
    );

    expect(s.CALL1_BOOKED.CONVERSION).toBe(0.4); // 28 booked / 70 qualified
  });

  it('computes cost per result and its change from FB spend', () => {
    const s = byStep(
      computeWeekOverWeek(twoWeeks({ fbSpend: 100, accepted: 1 }, { fbSpend: 100, accepted: 2 }))
    );

    // this: 700 spend / 7 accepted = 100; prev: 700 / 14 = 50 → cost doubled (+100%)
    expect(s.ACCEPTED.COST_PER_RESULT).toBe(100);
    expect(s.ACCEPTED.COST_PCT_CHANGE).toBe(1);
  });

  it('leaves conversion and cost blank for FB_SPEND', () => {
    const s = byStep(computeWeekOverWeek(twoWeeks({ fbSpend: 500 }, { fbSpend: 400 })));

    expect(s.FB_SPEND.THIS_7D).toBe(3500); // 500 * 7
    expect(s.FB_SPEND.CONVERSION).toBe('');
    expect(s.FB_SPEND.COST_PER_RESULT).toBe('');
  });
});
