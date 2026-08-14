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
    noShowFb: 0,
    noShowOrganic: 0,
    disqualifiedLost: 0,
    held: 0,
    heldFb: 0,
    heldOrganic: 0,
    leadDaysSum: 0,
    leadBookings: 0,
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
    // Every metric gets a group header — including Held and No show (the latter is easy to
    // drop since it has no Cost/w-w column).
    expect(m[0]).toContain('Accepted');
    expect(m[0]).toContain('Held');
    expect(m[0]).toContain('No show');
    expect(m[0]).toContain('Call 1 booked');
    expect(m[0]).toContain('Spend');
    // Accepted is first, leads with a Cost column, and drops w/w (Cost · ALL · FB · Organic).
    expect(m[1].slice(0, 5)).toEqual(['Date', 'Cost', 'ALL', 'FB', 'Organic']);
    // Held (2nd metric, reversed-funnel order) leads with Cost (Cost · ALL · w/w · FB · Organic).
    expect(m[1].slice(5, 10)).toEqual(['Cost', 'ALL', 'w/w', 'FB', 'Organic']);
    expect(m[2][0]).toBe('7d avg');
    expect(m[3][0]).toBe('MTD');
    expect(m[4][0]).toBe('Prev Month');
  });

  it('writes the summary rows as live sheet formulas', () => {
    const m = computeDailyMetrics(
      days(() => ({ bookedAll: 10 })),
      '2026-07-28'
    );

    // Spend is the last metric; with "Days to call" inserted after Call 1 booked (+3 cols),
    // Spend ALL is column AT (index 45). 7d avg = AVERAGE of the last 7 *completed* daily rows,
    // listed explicitly because weekly summary rows sit between them (rows 8/16/24). Today
    // (2026-07-28, row 6) skipped → row 7.
    expect(m[2][45]).toBe('=IFERROR(AVERAGE(AT7,AT9,AT10,AT11,AT12,AT13,AT14),0)');
    // MTD is a live window: 1st of this month (EOMONTH(TODAY(),-1)+1) through TODAY(). The
    // SUMIFS range spans to row 24 (the block's last row) — weekly rows are text in col A,
    // so the date criteria skip them.
    expect(String(m[3][45])).toContain('SUMIFS(AT$6:AT$24');
    expect(String(m[3][45])).toContain('">="&(EOMONTH(TODAY(),-1)+1)');
    expect(String(m[3][45])).toContain('"<="&TODAY()');
    // Prev Month = all of last month: EOMONTH(TODAY(),-2)+1 through EOMONTH(TODAY(),-1).
    expect(String(m[4][45])).toContain('">="&(EOMONTH(TODAY(),-2)+1)');
    expect(String(m[4][45])).toContain('"<="&EOMONTH(TODAY(),-1)');
  });

  it('shows daily w/w as the day vs the same weekday last week', () => {
    // Spend is 100 on the newest day and 80 exactly 7 days earlier → +25%.
    const rows = days((i) => ({ fbSpend: i === 0 ? 100 : i === 7 ? 80 : 90 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // First daily row is m[5]; Spend ALL is col 45 (AT), its w/w is col 46.
    expect(m[5][45]).toBe(100);
    expect(m[5][46]).toBe(0.25);
  });

  it('leaves w/w blank when there is no week-ago row', () => {
    const rows = days(() => ({ fbSpend: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');
    // The very last row is now a weekly summary; grab the oldest *daily* row (a real date).
    const lastDaily = [...m].reverse().find((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r[0])))!;

    expect(lastDaily[46]).toBe(''); // Spend w/w (col 46)
  });

  it('averages CPC in the 7d summary and blanks its Organic column', () => {
    const rows = days(() => ({ fbSpend: 200, fbClicks: 100 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Reversed funnel with Days to call inserted after Call 1 booked: Accepted(1-4) Held(5-9)
    // No show(10-12) Call1(13-17) Days to call(18-20) Qualified(21-25) Partial(26-30) CTA(31-35)
    // Page views(36-40), then CPC: ALL 41 (AP), FB 43 (AR), Organic 44 (AS).
    expect(m[2][41]).toBe('=IFERROR(AVERAGE(AP7,AP9,AP10,AP11,AP12,AP13,AP14),0)'); // ALL 7d avg
    expect(m[2][43]).toBe('=IFERROR(AVERAGE(AR7,AR9,AR10,AR11,AR12,AR13,AR14),0)'); // FB mirrors ALL
    expect(m[2][44]).toBe(''); // no organic ad spend → blank
  });

  it('splits the funnel steps into FB/Organic and costs per ALL action', () => {
    const rows = days(() => ({
      pageView: 10,
      pageViewFb: 7,
      pageViewOrganic: 3,
      fbSpend: 1000,
    }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Page views (after the +3 Days-to-call shift): Cost=36 (AK), ALL=37 (AL), FB=39 (AN),
    // Organic=40 (AO).
    const firstDaily = m[5];

    expect(firstDaily[36]).toBe(100); // Cost = 1000 FB spend / 10 ALL views (not FB 7)
    expect(firstDaily[37]).toBe(10); // ALL
    expect(firstDaily[39]).toBe(7); // FB
    expect(firstDaily[40]).toBe(3); // Organic
  });

  it('adds a weekly summary row at the bottom of each 7-day block', () => {
    // Every day: 100 spend + 2 Call 1 booked. The 2026-07-20 block is a full 7 days.
    const rows = days(() => ({ fbSpend: 100, bookedAll: 2, bookedFb: 2 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    const weekly = m.filter((r) => String(r[0]).startsWith('Week of'));

    // One summary per ISO-week block present in the 16 days (3 blocks).
    expect(weekly.length).toBe(3);

    const fullWeek = weekly.find((r) => r[0] === 'Week of 2026-07-20')!;

    expect(fullWeek[45]).toBe(700); // Spend ALL = 7 × 100 (sum, col AT)
    expect(fullWeek[46]).toBe(''); // Spend w/w left blank on weekly rows
    expect(fullWeek[14]).toBe(14); // Call 1 booked ALL = 7 × 2 (col O, before the shift)
    expect(fullWeek[13]).toBe(50); // Call 1 booked Cost = 700 spend ÷ 14 booked (col N)
  });

  it('costs the 7d Cost column as Σ FB spend ÷ Σ ALL actions', () => {
    const rows = days(() => ({ pageView: 10, pageViewFb: 7, fbSpend: 1000 }));
    const m = computeDailyMetrics(rows, '2026-07-28');

    // Page views Cost (col 36, AK): Σ Spend ALL (AT, all FB) ÷ Σ Page views ALL (AL), over
    // the explicit completed-day rows (weekly summary rows skipped).
    expect(m[2][36]).toBe(
      '=IFERROR(SUM(AT7,AT9,AT10,AT11,AT12,AT13,AT14)/SUM(AL7,AL9,AL10,AL11,AL12,AL13,AL14),0)'
    );
  });
});
