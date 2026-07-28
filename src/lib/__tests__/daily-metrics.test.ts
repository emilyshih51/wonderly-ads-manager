import { describe, expect, it } from 'vitest';

import { computeDailyMetrics } from '@/lib/daily-metrics';
import type { MarketingDailyRow } from '@/lib/marketing-daily';

function row(date: string, o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date,
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
    expect(m[1].slice(0, 3)).toEqual(['Date', 'ALL', 'w/w']);
    expect(m[2][0]).toBe('7d avg');
    expect(m[3][0]).toBe('MTD');
    expect(m[4][0]).toBe('Prev Month');
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

  it('aggregates CPC as total spend / total clicks over the window', () => {
    const rows = days(() => ({ fbSpend: 200, fbClicks: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // CPC is the 2nd metric → ALL at index 3. 7d avg row is m[2]. 1400/700 = 2.
    expect(m[2][3]).toBe(2);
  });
});
