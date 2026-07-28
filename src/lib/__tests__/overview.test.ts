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
    estAmount: 0,
    contactName: '',
    phone: '',
    email: '',
    source: 'facebook',
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

  it('computes cost per confirmed Call 1 and accepted over 7 days', () => {
    const rows = Array(7)
      .fill(0)
      .map(() => row({ date: '2026-07-28', fbSpend: 100, bookedAll: 2, accepted: 1 }));
    const m = computeOverview({ ...base, rows });

    // 700 spend / 14 booked = 50; 700 / 7 accepted = 100
    expect(line(m, 'Cost per confirmed Call 1')[1]).toBe(50);
    expect(line(m, 'Cost per accepted contractor')[1]).toBe(100);
  });

  it('keeps the two succeeding rows pending', () => {
    const m = computeOverview({ ...base, rows: [row()] });

    expect(line(m, 'Cost per succeeding contractor (60d)')[1]).toBe('pending deal→customer link');
    expect(line(m, 'Cost per succeeding contractor (90d)')[1]).toBe('pending deal→customer link');
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
