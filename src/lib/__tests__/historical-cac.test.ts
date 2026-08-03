import { describe, expect, it } from 'vitest';

import { toHistoricalCacValues, HISTORICAL_CAC_HEADERS } from '@/lib/historical-cac';
import type { MarketingDailyRow } from '@/lib/marketing-daily';

function row(date: string, o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date,
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
    noShowFb: 0,
    noShowOrganic: 0,
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

describe('toHistoricalCacValues', () => {
  const rows = [
    row('2026-05-10', { fbSpend: 1000, bookedAll: 10, accepted: 2 }),
    row('2026-05-20', { fbSpend: 1000, bookedAll: 10, accepted: 2 }),
    row('2026-06-15', { fbSpend: 3000, bookedAll: 20, accepted: 3 }),
  ];

  it('produces a month row per booking month plus an all-time total', () => {
    const v = toHistoricalCacValues(rows, '2026-12-01'); // far future: all months mature

    // 2026-05: spend 2000, booked 20, accepted 4 → rate 0.2, CAC 2000/4 = 500.
    expect(v[0]).toEqual(['2026-05', 2000, 20, 4, 0.2, 500, '']);
    // 2026-06: spend 3000, booked 20, accepted 3 → CAC 1000.
    expect(v[1]).toEqual(['2026-06', 3000, 20, 3, 0.15, 1000, '']);
    // All-time: spend 5000, booked 40, accepted 7 → CAC 5000/7 ≈ 714.29.
    expect(v[2]).toEqual(['All-time', 5000, 40, 7, 0.175, 714.29, '']);
  });

  it('flags recent months as maturing but not older ones', () => {
    // today 2026-08-01 → cutoff ~2026-06-02: May (ends 05-31) is mature, June (ends 06-30) maturing.
    const v = toHistoricalCacValues(rows, '2026-08-01');

    expect(v.find((r) => r[0] === '2026-05')?.[6]).toBe('');
    expect(v.find((r) => r[0] === '2026-06')?.[6]).toBe('maturing');
  });

  it('has a header for every column', () => {
    expect(HISTORICAL_CAC_HEADERS).toHaveLength(7);
  });
});
