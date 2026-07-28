import { describe, expect, it } from 'vitest';

import { DAILY_FUNNEL_HEADERS, toDailyFunnelValues } from '@/lib/daily-funnel';
import type { MarketingDailyRow } from '@/lib/marketing-daily';

function row(o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date: '2026-07-27',
    pageView: 0,
    ctaClicked: 0,
    submitPartial: 0,
    submitQualified: 0,
    bookedAll: 0,
    bookedFb: 0,
    bookedOrganic: 0,
    accepted: 0,
    noShow: 0,
    disqualifiedLost: 0,
    held: 0,
    fbSpend: 0,
    fbImpressions: 0,
    fbClicks: 0,
    ...o,
  };
}

/** Map a funnel row to { header: value } for readable assertions. */
function asMap(values: (string | number)[]): Record<string, string | number> {
  return Object.fromEntries(DAILY_FUNNEL_HEADERS.map((h, i) => [h, values[i]]));
}

describe('toDailyFunnelValues', () => {
  it('emits one row per day in header order', () => {
    const values = toDailyFunnelValues([row(), row({ date: '2026-07-26' })]);

    expect(values).toHaveLength(2);
    expect(values[0]).toHaveLength(DAILY_FUNNEL_HEADERS.length);
  });

  it('computes step-to-step conversion rates', () => {
    const m = asMap(
      toDailyFunnelValues([
        row({
          pageView: 1000,
          ctaClicked: 100,
          submitPartial: 50,
          submitQualified: 25,
          bookedAll: 10,
          held: 6,
          accepted: 2,
        }),
      ])[0]
    );

    expect(m.CTA_RATE).toBe(0.1); // 100 / 1000
    expect(m.PARTIAL_RATE).toBe(0.5); // 50 / 100
    expect(m.QUAL_RATE).toBe(0.5); // 25 / 50
    expect(m.CALL1_RATE).toBe(0.4); // 10 / 25
    expect(m.HELD_RATE).toBe(0.6); // 6 / 10 (vs Call 1 booked)
    expect(m.ACCEPT_RATE).toBe(0.2); // 2 / 10 (vs Call 1 booked)
  });

  it('computes cost per result from FB spend', () => {
    const m = asMap(toDailyFunnelValues([row({ fbSpend: 800, bookedAll: 4, accepted: 2 })])[0]);

    expect(m.FB_SPEND).toBe(800);
    expect(m.COST_PER_CALL1).toBe(200); // 800 / 4
    expect(m.COST_PER_ACCEPTED).toBe(400); // 800 / 2
  });

  it('never divides by zero', () => {
    const m = asMap(toDailyFunnelValues([row({ fbSpend: 500 })])[0]);

    expect(m.CTA_RATE).toBe(0);
    expect(m.COST_PER_ACCEPTED).toBe(0);
  });
});
