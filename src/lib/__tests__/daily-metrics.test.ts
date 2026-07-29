import { describe, expect, it } from 'vitest';

import { computeDailyMetrics } from '@/lib/daily-metrics';
import { blankMarketingRow, type MarketingDailyRow } from '@/lib/marketing-daily';

function row(date: string, o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    ...blankMarketingRow(date),
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
    expect(m[1].slice(0, 8)).toEqual([
      'Date',
      'ALL',
      'w/w',
      'FB',
      'Google',
      'Yahoo',
      'Bing',
      'N/A',
    ]);
    expect(m[2][0]).toBe('7d avg');
    expect(m[3][0]).toBe('MTD');
    expect(m[4][0]).toBe('Prev Month');
  });

  it('writes the summary rows as live sheet formulas', () => {
    const m = computeDailyMetrics(
      days(() => ({ bookedAll: 10 })),
      '2026-07-28'
    );

    // Spend ALL is column B. 7d avg = AVERAGE of the last 7 *completed* days; since the
    // newest row is today (2026-07-28), it's skipped, so the range starts at row 7.
    expect(m[2][1]).toBe('=IFERROR(AVERAGE(B7:B13),0)');
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

  it('averages CPC in the 7d summary and blanks its non-FB channels', () => {
    const rows = days(() => ({ fbSpend: 200, fbClicks: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // 7 cols/metric: CPC is the 2nd metric → ALL at index 8 (I), FB at 10 (K), Google at 11.
    expect(m[2][8]).toBe('=IFERROR(AVERAGE(I7:I13),0)'); // ALL 7d avg (today skipped)
    expect(m[2][10]).toBe('=IFERROR(AVERAGE(K7:K13),0)'); // FB mirrors ALL
    expect(m[2][11]).toBe(''); // Google — no ad spend there → blank
  });

  it('splits the funnel steps five ways from page view on', () => {
    const rows = days(() => ({
      pageView: 12,
      pageViewFb: 7,
      pageViewGoogle: 3,
      pageViewYahoo: 1,
      pageViewBing: 1,
      pageViewNa: 0,
    }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Page views is the 3rd metric → group starts at col 15 (1 + 2*7).
    const firstDaily = m[5];

    expect(firstDaily[15]).toBe(12); // ALL
    expect(firstDaily[17]).toBe(7); // FB
    expect(firstDaily[18]).toBe(3); // Google
    expect(firstDaily[19]).toBe(1); // Yahoo
    expect(firstDaily[20]).toBe(1); // Bing
    expect(firstDaily[21]).toBe(0); // N/A
  });
});
