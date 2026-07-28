import { describe, expect, it } from 'vitest';

import { computeDailyMetrics } from '@/lib/daily-metrics';
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

/** 16 consecutive days ending 2026-07-28, newest first. */
function days(make: (i: number) => Partial<MarketingDailyRow>): MarketingDailyRow[] {
  return Array.from({ length: 16 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 28 - i)).toISOString().slice(0, 10);

    return row(d, make(i));
  });
}

describe('computeDailyMetrics', () => {
  it('lays out the group + sub-headers and summary rows', () => {
    const m = computeDailyMetrics(
      days(() => ({ bookedAll: 10 })),
      '2026-07-28'
    );

    expect(m[0][0]).toBe(''); // group-header corner
    expect(m[0]).toContain('Spend');
    expect(m[0]).toContain('Call 1 booked');
    expect(m[1].slice(0, 5)).toEqual(['Date', 'ALL', 'w/w', 'FB', 'Organic']);
    expect(m[2][0]).toBe('7d avg');
    expect(m[3][0]).toBe('MTD');
    expect(m[4][0]).toBe('Prev Month');
  });

  it('writes the summary rows as live sheet formulas', () => {
    const m = computeDailyMetrics(
      days(() => ({ bookedAll: 10 })),
      '2026-07-28'
    );

    // Spend ALL is column B. 7d avg = AVERAGE of the daily block; MTD = SUMIFS by date.
    expect(m[2][1]).toBe('=IFERROR(AVERAGE(B6:B12),0)');
    expect(String(m[3][1])).toContain('SUMIFS(B$6:B$21');
    expect(String(m[3][1])).toContain('DATE(2026,7,1)');
    // Prev Month reaches into June (30 days).
    expect(String(m[4][1])).toContain('DATE(2026,6,30)');
  });

  it('shows daily w/w as the day vs the same weekday last week', () => {
    // Spend is 100 on the newest day and 80 exactly 7 days earlier → +25%.
    const rows = days((i) => ({ fbSpend: i === 0 ? 100 : i === 7 ? 80 : 90 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // First daily row is m[5]; Spend ALL is col 1, its w/w is col 2.
    expect(m[5][1]).toBe(100);
    expect(m[5][2]).toBe(0.25);
  });

  it('leaves w/w blank when there is no week-ago row', () => {
    const rows = days(() => ({ fbSpend: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');
    const lastDaily = m[m.length - 1]; // oldest row, no row 7 back

    expect(lastDaily[2]).toBe('');
  });

  it('averages CPC in the 7d summary and blanks its Organic column', () => {
    const rows = days(() => ({ fbSpend: 200, fbClicks: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // CPC is the 2nd metric: ALL at column index 5 (F), FB at 7 (H), Organic at 8 (I).
    expect(m[2][5]).toBe('=IFERROR(AVERAGE(F6:F12),0)'); // ALL 7d avg
    expect(m[2][7]).toBe('=IFERROR(AVERAGE(H6:H12),0)'); // FB mirrors ALL
    expect(m[2][8]).toBe(''); // no organic ad spend → blank
  });

  it('splits the funnel steps into FB and Organic from page view on', () => {
    const rows = days(() => ({
      pageView: 10,
      pageViewFb: 7,
      pageViewOrganic: 3,
      bookedAll: 4,
      bookedFb: 3,
      bookedOrganic: 1,
    }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Page views is the 3rd metric → group starts at index 9 (ALL/w-w/FB/Organic).
    const firstDaily = m[5];

    expect(firstDaily[9]).toBe(10); // ALL
    expect(firstDaily[11]).toBe(7); // FB
    expect(firstDaily[12]).toBe(3); // Organic
  });
});
