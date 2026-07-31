import { describe, expect, it } from 'vitest';

import type { Call1DealRow } from '@/lib/call1-deals';
import { computeOverview } from '@/lib/overview';
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

function deal(o: Partial<Call1DealRow> = {}): Call1DealRow {
  return {
    dealId: 'd',
    dealName: '',
    bookedDay: '2026-07-20',
    currentStage: '',
    held: 0,
    accepted: 0,
    noShow: 0,
    disqualified: 0,
    estAmount: 0,
    contactName: '',
    phone: '',
    email: '',
    source: 'facebook',
    campaignId: '',
    adId: '',
    heldDate: '',
    acceptedDate: '',
    ...o,
  };
}

/** Flatten the matrix to a single string for easy "contains" checks. */
function flat(matrix: (string | number)[][]): string {
  return matrix.map((r) => r.join('|')).join('\n');
}

/** Find the row whose first cell equals `label`. */
function line(matrix: (string | number)[][], label: string): (string | number)[] {
  return matrix.find((r) => r[0] === label) ?? [];
}

describe('computeOverview', () => {
  const base = {
    call1Deals: [deal()],
    succeeding: {
      matured60: 0,
      succeeding60: 0,
      matured90: 0,
      succeeding90: 0,
      cohort60Start: '',
      cohort60End: '',
      cohort90Start: '',
      cohort90End: '',
    },
    lastRefreshedPt: 'Jul 28, 2026, 2:30 PM',
    today: '2026-07-28',
  };

  it('shows freshness and flags stale data', () => {
    const fresh = computeOverview({ ...base, rows: [row({ date: '2026-07-28' })] });

    expect(line(fresh, 'Last refreshed (PT)')[1]).toBe('Jul 28, 2026, 2:30 PM');
    expect(flat(fresh)).toContain('✓ Data current through 2026-07-28');

    const stale = computeOverview({ ...base, rows: [row({ date: '2026-07-25' })] });

    expect(flat(stale)).toContain('⚠️ Data is stale');
  });

  it('computes cost per Call 1 booked and accepted over the last 7 completed days', () => {
    // Dated 07-27 (< today 07-28) so they count as completed days.
    const rows = Array(7)
      .fill(0)
      .map(() => row({ date: '2026-07-27', fbSpend: 100, bookedAll: 2 }));
    // Cost per accepted is flow-keyed: 7 acceptances dated in the window → 700 / 7 = 100.
    const call1Deals = Array(7)
      .fill(0)
      .map(() => deal({ acceptedDate: '2026-07-27' }));
    const m = computeOverview({ ...base, rows, call1Deals });

    // 700 spend / 14 booked = 50; 700 spend / 7 acceptances = 100
    expect(line(m, 'Cost per Call 1 booked')[1]).toBe(50);
    expect(line(m, 'Cost per accepted contractor')[1]).toBe(100);
  });

  it('computes cost per accepted contractor over the last 30 completed days', () => {
    // 30 completed days: 30×200 spend / 30×2 accepted = 6000/60 = 100.
    const rows = Array(30)
      .fill(0)
      .map(() => row({ date: '2026-07-27', fbSpend: 200, accepted: 2 }));
    const m = computeOverview({ ...base, rows });

    expect(line(m, 'Cost per accepted contractor (30d)')[1]).toBe(100);
  });

  it('keeps the week-over-week ACCEPTED flow-keyed and consistent with the headline', () => {
    // Daily rows carry cohort accepted = 0 for the window; call1Deals has 3 acceptances by date.
    const rows = Array(7)
      .fill(0)
      .map(() => row({ date: '2026-07-27', fbSpend: 100, accepted: 0 }));
    const call1Deals = [
      deal({ acceptedDate: '2026-07-27' }),
      deal({ acceptedDate: '2026-07-27' }),
      deal({ acceptedDate: '2026-07-27' }),
    ];
    const m = computeOverview({ ...base, rows, call1Deals });

    // w/w ACCEPTED THIS_7D shows the flow count (3), not the cohort 0.
    expect(line(m, 'ACCEPTED')[1]).toBe(3);
    // Headline reconciles: 700 spend / 3 acceptances = 233.33.
    expect(line(m, 'Cost per accepted contractor')[1]).toBe(233.33);
  });

  it('shows the succeeding rows as maturing when the cohort is small', () => {
    const m = computeOverview({
      ...base,
      rows: [row()],
      succeeding: {
        ...base.succeeding,
        matured60: 3,
        succeeding60: 1,
        matured90: 2,
        succeeding90: 0,
      },
    });

    expect(line(m, 'Cost per succeeding contractor (60d)')[1]).toBe(
      'maturing — 1/3 cohort succeeding (P&L > 0)'
    );
    expect(line(m, 'Cost per succeeding contractor (90d)')[1]).toBe(
      'maturing — 0/2 cohort succeeding (P&L > 0)'
    );
  });

  it('computes cost per succeeding contractor once the cohort is large enough', () => {
    // Rows dated 07-27; the cohort window covers that day, so cohort spend = 3×1000.
    const rows = Array(3)
      .fill(0)
      .map(() => row({ date: '2026-07-27', fbSpend: 1000 }));
    const m = computeOverview({
      ...base,
      rows,
      succeeding: {
        matured60: 20,
        succeeding60: 6,
        matured90: 15,
        succeeding90: 5,
        cohort60Start: '2026-07-27',
        cohort60End: '2026-07-27',
        cohort90Start: '2026-07-27',
        cohort90End: '2026-07-27',
      },
    });

    // 3000 cohort-window spend / 6 succeeding (60d) = 500; / 5 (90d) = 600.
    expect(line(m, 'Cost per succeeding contractor (60d)')[1]).toBe(500);
    expect(line(m, 'Cost per succeeding contractor (90d)')[1]).toBe(600);
  });

  it('warns when Call 1 bookings drop more than 15% week-over-week', () => {
    const rows = [
      ...Array(7)
        .fill(0)
        .map(() => row({ bookedAll: 8 })), // this week: 56
      ...Array(7)
        .fill(0)
        .map(() => row({ bookedAll: 10 })), // prev week: 70 → -20%
    ];

    expect(flat(computeOverview({ ...base, rows }))).toContain('⚠️ Call 1 bookings -20.0%');
  });

  it('warns when source attribution is below 95%', () => {
    const call1Deals = [deal({ source: 'facebook' }), deal({ source: '' }), deal({ source: '' })];

    expect(flat(computeOverview({ ...base, rows: [row()], call1Deals }))).toContain(
      'of Call 1s have no attributed source'
    );
  });

  it('includes the week-over-week block', () => {
    const m = computeOverview({ ...base, rows: [row()] });

    expect(flat(m)).toContain('SEVEN DAYS vs PREVIOUS SEVEN DAYS');
    expect(m.some((r) => r[0] === 'ACCEPTED')).toBe(true);
  });
});
