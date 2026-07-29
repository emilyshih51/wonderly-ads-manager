import { describe, expect, it } from 'vitest';

import {
  blankMarketingRow,
  checkStaleness,
  joinMarketingDaily,
  mergeRows,
  parseMarketingRows,
  toSheetValues,
  RAW_TAB_HEADERS,
  type MarketingDailyRow,
  type MetaDailySpend,
} from '@/lib/marketing-daily';

function spend(date: string, o: Partial<MetaDailySpend> = {}): MetaDailySpend {
  return { date, spend: 0, impressions: 0, clicks: 0, ...o };
}

function mkt(date: string, o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return { ...blankMarketingRow(date), ...o };
}

const row = mkt;

/** Column index of a header, for order-independent assertions. */
const col = (header: string) => RAW_TAB_HEADERS.indexOf(header);

describe('joinMarketingDaily', () => {
  it('joins spend to the funnel on date', () => {
    const rows = joinMarketingDaily(
      [spend('2026-07-23', { spend: 4937.12, clicks: 1044 })],
      [mkt('2026-07-23', { pageView: 972, bookedAll: 16, bookedFb: 16, accepted: 6 })]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-07-23',
      fbSpend: 4937.12,
      fbClicks: 1044,
      pageView: 972,
      bookedAll: 16,
      bookedFb: 16,
      accepted: 6,
    });
  });

  it('keeps a spend day with no funnel', () => {
    const rows = joinMarketingDaily([spend('2026-07-23', { spend: 4937.12 })], []);

    expect(rows[0].fbSpend).toBe(4937.12);
    expect(rows[0].bookedAll).toBe(0);
  });

  it('keeps a funnel day with no spend', () => {
    const rows = joinMarketingDaily([], [mkt('2026-07-23', { bookedNa: 3, bookedAll: 3 })]);

    expect(rows[0].fbSpend).toBe(0);
    expect(rows[0].bookedNa).toBe(3);
  });

  it('sorts newest first', () => {
    const rows = joinMarketingDaily(
      [spend('2026-07-21'), spend('2026-07-23'), spend('2026-07-22')],
      []
    );

    expect(rows.map((r) => r.date)).toEqual(['2026-07-23', '2026-07-22', '2026-07-21']);
  });
});

describe('toSheetValues / parseMarketingRows', () => {
  it('emits columns in header order and round-trips through the parser', () => {
    const original = mkt('2026-07-23', {
      fbSpend: 4937.12,
      fbImpressions: 57000,
      fbClicks: 1044,
      pageView: 972,
      pageViewFb: 700,
      pageViewGoogle: 200,
      bookedAll: 16,
      bookedFb: 16,
      accepted: 6,
      acceptedFb: 5,
      noShow: 2,
      disqualifiedLost: 3,
      held: 14,
      heldFb: 9,
    });
    const values = toSheetValues([original]);

    expect(values[0]).toHaveLength(RAW_TAB_HEADERS.length);
    expect(values[0][col('DATE')]).toBe('2026-07-23');
    expect(values[0][col('FB_SPEND')]).toBe(4937.12);
    expect(values[0][col('PAGE_VIEW')]).toBe(972);
    expect(values[0][col('PAGE_VIEW_FB')]).toBe(700);
    expect(values[0][col('PAGE_VIEW_GOOGLE')]).toBe(200);
    expect(values[0][col('BOOKED_ALL')]).toBe(16);
    expect(values[0][col('ACCEPTED_FB')]).toBe(5);
    expect(values[0][col('HELD')]).toBe(14);
    expect(values[0][col('DISQUALIFIED_LOST')]).toBe(3);

    // Round-trip: header row + the data row parse back to the same values.
    const parsed = parseMarketingRows([RAW_TAB_HEADERS, values[0]]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(original);
  });
});

describe('mergeRows', () => {
  it('lets fresh rows win over existing ones', () => {
    const existing = [row('2026-07-23', { fbSpend: 4000 })];
    const fresh = [row('2026-07-23', { fbSpend: 4937.12 })];

    expect(mergeRows(existing, fresh)[0].fbSpend).toBe(4937.12);
  });

  it('preserves older rows outside the refetch window', () => {
    const merged = mergeRows([row('2026-01-01', { fbSpend: 99 })], [row('2026-07-23')]);

    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.date === '2026-01-01')?.fbSpend).toBe(99);
  });
});

describe('checkStaleness', () => {
  it('passes on fresh data', () => {
    expect(
      checkStaleness([row('2026-07-23', { fbSpend: 4937, pageView: 972 })], '2026-07-23')
    ).toBeNull();
  });

  it('flags data that stopped arriving', () => {
    expect(checkStaleness([row('2026-05-04', { fbSpend: 1, pageView: 1 })], '2026-07-23')).toMatch(
      /stale/
    );
  });

  it('flags all-zero spend (Meta side broken)', () => {
    const rows = [
      row('2026-07-23', { fbSpend: 0, pageView: 900 }),
      row('2026-07-22', { fbSpend: 0, pageView: 900 }),
      row('2026-07-21', { fbSpend: 0, pageView: 900 }),
    ];

    expect(checkStaleness(rows, '2026-07-23')).toMatch(/\$0/);
  });

  it('flags all-zero page views (Snowflake side broken)', () => {
    const rows = [
      row('2026-07-23', { fbSpend: 100, pageView: 0 }),
      row('2026-07-22', { fbSpend: 100, pageView: 0 }),
      row('2026-07-21', { fbSpend: 100, pageView: 0 }),
    ];

    expect(checkStaleness(rows, '2026-07-23')).toMatch(/Snowflake/);
  });
});
