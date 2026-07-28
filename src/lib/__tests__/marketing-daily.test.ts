import { describe, expect, it } from 'vitest';

import {
  checkStaleness,
  joinMarketingDaily,
  mergeRows,
  toSheetValues,
  RAW_TAB_HEADERS,
  type DailyMarketingRow,
  type MarketingDailyRow,
  type MetaDailySpend,
} from '@/lib/marketing-daily';

function spend(date: string, o: Partial<MetaDailySpend> = {}): MetaDailySpend {
  return { date, spend: 0, impressions: 0, clicks: 0, ...o };
}

function mkt(date: string, o: Partial<DailyMarketingRow> = {}): DailyMarketingRow {
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
    confirmedCall1: 0,
    ...o,
  };
}

function row(date: string, o: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return { ...mkt(date), fbSpend: 0, fbImpressions: 0, fbClicks: 0, ...o };
}

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

  it('keeps a funnel day with no spend (organic)', () => {
    const rows = joinMarketingDaily([], [mkt('2026-07-23', { bookedOrganic: 3, bookedAll: 3 })]);

    expect(rows[0].fbSpend).toBe(0);
    expect(rows[0].bookedOrganic).toBe(3);
  });

  it('sorts newest first', () => {
    const rows = joinMarketingDaily(
      [spend('2026-07-21'), spend('2026-07-23'), spend('2026-07-22')],
      []
    );

    expect(rows.map((r) => r.date)).toEqual(['2026-07-23', '2026-07-22', '2026-07-21']);
  });
});

describe('toSheetValues', () => {
  it('emits columns in RAW_TAB_HEADERS order', () => {
    const values = toSheetValues([
      row('2026-07-23', {
        fbSpend: 4937.12,
        fbImpressions: 57000,
        fbClicks: 1044,
        pageView: 972,
        ctaClicked: 129,
        submitPartial: 73,
        submitQualified: 18,
        bookedAll: 16,
        bookedFb: 16,
        bookedOrganic: 0,
        accepted: 6,
        noShow: 2,
        disqualifiedLost: 3,
        held: 14,
        confirmedCall1: 20,
      }),
    ]);

    expect(values[0]).toEqual([
      '2026-07-23',
      4937.12,
      57000,
      1044,
      972,
      129,
      73,
      18,
      16,
      16,
      0,
      6,
      2,
      3,
      14,
      20,
    ]);
    expect(values[0]).toHaveLength(RAW_TAB_HEADERS.length);
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
