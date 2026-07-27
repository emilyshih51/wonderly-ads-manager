import { describe, expect, it } from 'vitest';

import {
  computeCall1Summary,
  toCall1DealsValues,
  CALL1_DEALS_HEADERS,
  type Call1DealRow,
} from '@/lib/call1-deals';
import type { MarketingDailyRow } from '@/lib/marketing-daily';

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
    source: 'facebook',
    ...o,
  };
}

function mkt(date: string, o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date,
    pageView: 0,
    ctaClicked: 0,
    submitPartial: 0,
    submitQualified: 0,
    bookedAll: 0,
    bookedFb: 0,
    bookedOrganic: 0,
    call1Booked: 0,
    accepted: 0,
    noShow: 0,
    disqualifiedLost: 0,
    salesCall1: 0,
    held: 0,
    fbSpend: 0,
    fbImpressions: 0,
    fbClicks: 0,
    ...o,
  };
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
        source: 'google',
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
      'google',
    ]);
    expect(values[0]).toHaveLength(CALL1_DEALS_HEADERS.length);
  });
});

describe('computeCall1Summary', () => {
  const today = '2026-07-27';

  it('counts sales deals inside the trailing window', () => {
    const deals = [
      deal({ dealId: 'in', bookedDay: '2026-07-10' }),
      deal({ dealId: 'old', bookedDay: '2026-05-01' }), // outside 30d
    ];

    const map = asMap(computeCall1Summary(deals, [], 30, today));

    expect(map['SALES_CALL1 (pipeline)']).toBe(1);
  });

  it('takes CALL1_BOOKED from the marketing BOOKING_COMPLETE count', () => {
    const marketing = [
      mkt('2026-07-20', { bookedAll: 2 }),
      mkt('2026-07-21', { bookedAll: 3 }),
      mkt('2026-05-01', { bookedAll: 9 }), // outside window
    ];

    const map = asMap(computeCall1Summary([], marketing, 30, today));

    expect(map['CALL1_BOOKED (marketing)']).toBe(5);
  });

  it('rates held, accepted, and no-show against the sales denominator', () => {
    const deals = [
      deal({ dealId: 'a', bookedDay: '2026-07-20', held: 1, accepted: 1 }),
      deal({ dealId: 'b', bookedDay: '2026-07-21', held: 1 }),
      deal({ dealId: 'c', bookedDay: '2026-07-22', noShow: 1 }),
      deal({ dealId: 'd', bookedDay: '2026-07-23' }),
    ];

    const map = asMap(computeCall1Summary(deals, [], 30, today));

    expect(map.HELD).toBe(2);
    expect(map.HELD_RATE).toBe(0.5); // 2 / 4 sales deals
    expect(map.BOOKED_TO_ACCEPTED_RATE).toBe(0.25);
    expect(map.NO_SHOW_RATE).toBe(0.25);
  });

  it('costs Call 1 by marketing bookings and CAC by accepted', () => {
    const deals = [
      deal({ dealId: 'a', bookedDay: '2026-07-20', accepted: 1 }),
      deal({ dealId: 'b', bookedDay: '2026-07-21', accepted: 1 }),
    ];
    const marketing = [
      mkt('2026-07-20', { fbSpend: 400, bookedAll: 1 }),
      mkt('2026-07-21', { fbSpend: 400, bookedAll: 1 }),
    ];

    const map = asMap(computeCall1Summary(deals, marketing, 30, today));

    expect(map.FB_SPEND).toBe(800);
    expect(map['CALL1_BOOKED (marketing)']).toBe(2);
    expect(map.COST_PER_CALL1).toBe(400); // 800 / 2 marketing bookings
    expect(map.ACCEPTED_CUSTOMER_CAC).toBe(400); // 800 / 2 accepted
  });

  it('excludes rows outside the window and never divides by zero', () => {
    const marketing = [
      mkt('2026-05-01', { fbSpend: 999, bookedAll: 9 }),
      mkt('2026-07-25', { fbSpend: 100, bookedAll: 0 }),
    ];

    const map = asMap(computeCall1Summary([], marketing, 30, today));

    expect(map.FB_SPEND).toBe(100);
    expect(map['CALL1_BOOKED (marketing)']).toBe(0);
    expect(map.COST_PER_CALL1).toBe(0);
    expect(map.ACCEPTED_CUSTOMER_CAC).toBe(0);
  });

  it('leaves cost per succeeding customer pending', () => {
    const map = asMap(computeCall1Summary([], [], 30, today));

    expect(map.COST_PER_SUCCEEDING_CUSTOMER).toBe('pending deal→customer link');
  });

  it('lets sales-based accepted exceed the marketing Call 1 count', () => {
    // Sales books more Call 1s than the form sees, so accepted can be > marketing bookings.
    const deals = [
      deal({ dealId: 'a', bookedDay: '2026-07-20', accepted: 1 }),
      deal({ dealId: 'b', bookedDay: '2026-07-21', accepted: 1 }),
      deal({ dealId: 'c', bookedDay: '2026-07-22', accepted: 1 }),
    ];
    const marketing = [mkt('2026-07-20', { bookedAll: 1 })];

    const map = asMap(computeCall1Summary(deals, marketing, 30, today));

    expect(map['CALL1_BOOKED (marketing)']).toBe(1);
    expect(map['ACCEPTED (maturing)']).toBe(3);
  });
});
