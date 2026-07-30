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
    expect(m[0]).toContain('Accepted');
    expect(m[0]).toContain('Spend');
    expect(m[0]).toContain('Call 1 booked');
    // Accepted is first and leads with a Cost column (Cost · ALL · w/w · FB · Organic).
    expect(m[1].slice(0, 6)).toEqual(['Date', 'Cost', 'ALL', 'w/w', 'FB', 'Organic']);
    // Spend (2nd metric) has no Cost column (ALL · w/w · FB · Organic).
    expect(m[1].slice(6, 10)).toEqual(['ALL', 'w/w', 'FB', 'Organic']);
    expect(m[2][0]).toBe('7d avg');
    expect(m[3][0]).toBe('MTD');
    expect(m[4][0]).toBe('Prev Month');
  });

  it('writes the summary rows as live sheet formulas', () => {
    const m = computeDailyMetrics(
      days(() => ({ bookedAll: 10 })),
      '2026-07-28'
    );

    // Spend ALL is column G (Accepted occupies cols B-F). 7d avg = AVERAGE of the last 7
    // *completed* days; the newest row is today (2026-07-28), skipped, so it starts at row 7.
    expect(m[2][6]).toBe('=IFERROR(AVERAGE(G7:G13),0)');
    // MTD is a live window: 1st of this month (EOMONTH(TODAY(),-1)+1) through TODAY().
    expect(String(m[3][6])).toContain('SUMIFS(G$6:G$21');
    expect(String(m[3][6])).toContain('">="&(EOMONTH(TODAY(),-1)+1)');
    expect(String(m[3][6])).toContain('"<="&TODAY()');
    // Prev Month = all of last month: EOMONTH(TODAY(),-2)+1 through EOMONTH(TODAY(),-1).
    expect(String(m[4][6])).toContain('">="&(EOMONTH(TODAY(),-2)+1)');
    expect(String(m[4][6])).toContain('"<="&EOMONTH(TODAY(),-1)');
  });

  it('shows daily w/w as the day vs the same weekday last week', () => {
    // Spend is 100 on the newest day and 80 exactly 7 days earlier → +25%.
    const rows = days((i) => ({ fbSpend: i === 0 ? 100 : i === 7 ? 80 : 90 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // First daily row is m[5]; Spend ALL is col 6 (G), its w/w is col 7.
    expect(m[5][6]).toBe(100);
    expect(m[5][7]).toBe(0.25);
  });

  it('leaves w/w blank when there is no week-ago row', () => {
    const rows = days(() => ({ fbSpend: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');
    const lastDaily = m[m.length - 1]; // oldest row, no row 7 back

    expect(lastDaily[7]).toBe(''); // Spend w/w (col 7)
  });

  it('averages CPC in the 7d summary and blanks its Organic column', () => {
    const rows = days(() => ({ fbSpend: 200, fbClicks: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Accepted (1-5) + Spend (6-9), then CPC (no Cost): ALL at 10 (K), FB at 12 (M), Organic 13.
    expect(m[2][10]).toBe('=IFERROR(AVERAGE(K7:K13),0)'); // ALL 7d avg (today skipped)
    expect(m[2][12]).toBe('=IFERROR(AVERAGE(M7:M13),0)'); // FB mirrors ALL
    expect(m[2][13]).toBe(''); // no organic ad spend → blank
  });

  it('splits the funnel steps into FB/Organic and costs per ALL action', () => {
    const rows = days(() => ({
      pageView: 10,
      pageViewFb: 7,
      pageViewOrganic: 3,
      fbSpend: 1000,
    }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Page views: Accepted (1-5) + Spend (6-9) + CPC (10-13), so Cost=14, ALL=15, FB=17, Org=18.
    const firstDaily = m[5];

    expect(firstDaily[14]).toBe(100); // Cost = 1000 FB spend / 10 ALL views (not FB 7)
    expect(firstDaily[15]).toBe(10); // ALL
    expect(firstDaily[17]).toBe(7); // FB
    expect(firstDaily[18]).toBe(3); // Organic
  });

  it('costs the 7d Cost column as Σ FB spend ÷ Σ ALL actions', () => {
    const rows = days(() => ({ pageView: 10, pageViewFb: 7, fbSpend: 1000 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Page views Cost (col 14): Σ Spend ALL (G, all FB) ÷ Σ Page views ALL (P).
    expect(m[2][14]).toBe('=IFERROR(SUM(G7:G13)/SUM(P7:P13),0)');
  });
});
