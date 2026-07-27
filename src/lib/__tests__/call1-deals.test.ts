import { describe, expect, it } from 'vitest';

import {
  computeCall1Summary,
  toCall1DealsValues,
  CALL1_DEALS_HEADERS,
  type Call1DealRow,
} from '@/lib/call1-deals';
import type { MetaDailySpend } from '@/lib/marketing-daily';

function deal(o: Partial<Call1DealRow> = {}): Call1DealRow {
  return {
    dealId: 'd1',
    dealName: 'Test Deal',
    bookedDay: '2026-07-20',
    currentStage: 'Call 1 Scheduled',
    held: 0,
    accepted: 0,
    noShow: 0,
    estAmount: 0,
    contactName: 'Jane Doe',
    phone: '+15551234567',
    email: 'jane@example.com',
    ...o,
  };
}

function spend(date: string, amount: number): MetaDailySpend {
  return { date, spend: amount, impressions: 0, clicks: 0 };
}

/** Turn the metric/value matrix into a lookup for readable assertions. */
function asMap(rows: (string | number)[][]): Record<string, string | number> {
  return Object.fromEntries(rows);
}

describe('toCall1DealsValues', () => {
  it('emits columns in header order', () => {
    const values = toCall1DealsValues([
      deal({
        dealId: 'abc',
        dealName: 'Harrison Wermuth (Dewittbuilding)',
        bookedDay: '2026-07-22',
        currentStage: 'Accepted',
        held: 1,
        accepted: 1,
        noShow: 0,
        estAmount: 12000,
        contactName: 'Harrison Wermuth',
        phone: '+15550001111',
        email: 'harrison@dewittbuilding.com',
      }),
    ]);

    expect(values[0]).toEqual([
      'abc',
      'Harrison Wermuth (Dewittbuilding)',
      '2026-07-22',
      'Accepted',
      1,
      1,
      0,
      12000,
      'Harrison Wermuth',
      '+15550001111',
      'harrison@dewittbuilding.com',
    ]);
    expect(values[0]).toHaveLength(CALL1_DEALS_HEADERS.length);
  });
});

describe('computeCall1Summary', () => {
  const today = '2026-07-27';

  it('counts only deals inside the trailing window', () => {
    const deals = [
      deal({ dealId: 'in', bookedDay: '2026-07-10' }),
      deal({ dealId: 'old', bookedDay: '2026-05-01' }), // outside 30d
    ];

    const map = asMap(computeCall1Summary(deals, [], 30, today));

    expect(map.REAL_CALL1_BOOKED).toBe(1);
  });

  it('computes held, accepted, and no-show rates', () => {
    const deals = [
      deal({ dealId: 'a', bookedDay: '2026-07-20', held: 1, accepted: 1 }),
      deal({ dealId: 'b', bookedDay: '2026-07-21', held: 1 }),
      deal({ dealId: 'c', bookedDay: '2026-07-22', noShow: 1 }),
      deal({ dealId: 'd', bookedDay: '2026-07-23' }),
    ];

    const map = asMap(computeCall1Summary(deals, [], 30, today));

    expect(map.HELD).toBe(2);
    expect(map.HELD_RATE).toBe(0.5);
    expect(map.BOOKED_TO_ACCEPTED_RATE).toBe(0.25);
    expect(map.NO_SHOW_RATE).toBe(0.25);
  });

  it('divides FB spend by Call 1s and by accepted for the cost figures', () => {
    const deals = [
      deal({ dealId: 'a', bookedDay: '2026-07-20', accepted: 1 }),
      deal({ dealId: 'b', bookedDay: '2026-07-21', accepted: 1 }),
      deal({ dealId: 'c', bookedDay: '2026-07-22' }),
      deal({ dealId: 'd', bookedDay: '2026-07-23' }),
    ];
    const daily = [spend('2026-07-20', 400), spend('2026-07-21', 400)];

    const map = asMap(computeCall1Summary(deals, daily, 30, today));

    expect(map.FB_SPEND).toBe(800);
    expect(map.COST_PER_REAL_CALL1).toBe(200); // 800 / 4
    expect(map.ACCEPTED_CUSTOMER_CAC).toBe(400); // 800 / 2
  });

  it('excludes spend outside the window and never divides by zero', () => {
    const daily = [spend('2026-05-01', 999), spend('2026-07-25', 100)];

    const map = asMap(computeCall1Summary([], daily, 30, today));

    expect(map.FB_SPEND).toBe(100);
    expect(map.COST_PER_REAL_CALL1).toBe(0);
    expect(map.ACCEPTED_CUSTOMER_CAC).toBe(0);
  });

  it('leaves cost per succeeding customer pending', () => {
    const map = asMap(computeCall1Summary([], [], 30, today));

    expect(map.COST_PER_SUCCEEDING_CUSTOMER).toBe('pending deal→customer link');
  });
});
