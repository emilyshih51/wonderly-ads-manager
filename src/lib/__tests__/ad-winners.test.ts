import { describe, it, expect } from 'vitest';

import {
  AD_WINNER_WINDOWS,
  classifyWinner,
  computeAdWinnerRows,
  toAdWinnerValues,
  type AdWinnerWindow,
} from '@/lib/ad-winners';
import type { MetaInsightsRow } from '@/types';

const LAST_7_DAYS = AD_WINNER_WINDOWS.find((w) => w.tabName === 'Last 7 Days') as AdWinnerWindow;
const ALL_TIME = AD_WINNER_WINDOWS.find((w) => w.tabName === 'All Time') as AdWinnerWindow;

/** Build a minimal ad-level insights row with one `offsite_conversion.fb_pixel_custom` action. */
function makeRow(overrides: Partial<MetaInsightsRow> & { results?: number } = {}): MetaInsightsRow {
  const { results = 0, ...rest } = overrides;

  return {
    ad_id: 'ad-1',
    ad_name: 'Test Ad',
    adset_id: 'adset-1',
    campaign_id: 'camp-1',
    spend: '100',
    impressions: '1000',
    clicks: '10',
    actions:
      results > 0
        ? [{ action_type: 'offsite_conversion.fb_pixel_custom', value: String(results) }]
        : [],
    date_start: '2026-08-01',
    date_stop: '2026-08-07',
    ...rest,
  } as MetaInsightsRow;
}

const OPTIMIZATION_MAP = { 'adset-1': 'offsite_conversion.fb_pixel_custom' };

describe('classifyWinner', () => {
  it('is blank below the Results floor, regardless of CPL', () => {
    expect(classifyWinner(2, 10, 3, 150)).toBe('');
  });

  it('is blank with zero results (null CPL)', () => {
    expect(classifyWinner(0, null, 3, 150)).toBe('');
  });

  it('is YES at exactly the CPL cap', () => {
    expect(classifyWinner(3, 150, 3, 150)).toBe('YES');
  });

  it('is YES comfortably under the cap', () => {
    expect(classifyWinner(5, 125.36, 3, 150)).toBe('YES');
  });

  it('is Near just above the cap', () => {
    expect(classifyWinner(13, 157.74, 3, 150)).toBe('Near');
  });

  it('is Near at exactly 1.5x the cap', () => {
    expect(classifyWinner(10, 225, 10, 150)).toBe('Near');
  });

  it('is blank just above 1.5x the cap', () => {
    expect(classifyWinner(10, 225.01, 10, 150)).toBe('');
  });

  it('is blank when far over cap even with plenty of results', () => {
    expect(classifyWinner(28, 286.61, 20, 150)).toBe('');
  });
});

describe('computeAdWinnerRows', () => {
  it('computes results, CPL, spend, status, and winner tier for one ad', () => {
    const rows = computeAdWinnerRows(
      [makeRow({ results: 5, spend: '626.78' })],
      { 'ad-1': 'ACTIVE' },
      OPTIMIZATION_MAP,
      {},
      '1403742814420018',
      '1630682394838664',
      LAST_7_DAYS
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      adId: 'ad-1',
      adName: 'Test Ad',
      results: 5,
      cpl: 125.36,
      spend: 626.78,
      status: 'ACTIVE',
      winner: 'YES',
    });
    expect(rows[0].adLink).toContain('act=1403742814420018');
    expect(rows[0].adLink).toContain('selected_ad_ids=ad-1');
  });

  it('falls back to the ad id as the name, and empty status, when either is missing', () => {
    const rows = computeAdWinnerRows(
      [makeRow({ ad_name: undefined, results: 1, spend: '10' })],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    expect(rows[0].adName).toBe('ad-1');
    expect(rows[0].status).toBe('');
  });

  it('gives a zero-result ad a null CPL and a blank winner tier', () => {
    const rows = computeAdWinnerRows(
      [makeRow({ results: 0, spend: '50' })],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    expect(rows[0].results).toBe(0);
    expect(rows[0].cpl).toBeNull();
    expect(rows[0].winner).toBe('');
  });

  it('sorts rows by spend descending', () => {
    const rows = computeAdWinnerRows(
      [
        makeRow({ ad_id: 'low', results: 3, spend: '100' }),
        makeRow({ ad_id: 'high', results: 3, spend: '900' }),
        makeRow({ ad_id: 'mid', results: 3, spend: '500' }),
      ],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    expect(rows.map((r) => r.adId)).toEqual(['high', 'mid', 'low']);
  });

  it('drops rows with no ad_id', () => {
    const rows = computeAdWinnerRows(
      [makeRow({ ad_id: undefined })],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    expect(rows).toHaveLength(0);
  });

  it('excludes registration-optimized ads only on a window that opts in', () => {
    const row = makeRow({ results: 25, spend: '1000' });

    const allTimeRows = computeAdWinnerRows(
      [row],
      {},
      OPTIMIZATION_MAP,
      { 'adset-1': 'COMPLETE_REGISTRATION' },
      '123',
      '456',
      ALL_TIME
    );

    expect(allTimeRows).toHaveLength(0);

    const last7Rows = computeAdWinnerRows(
      [row],
      {},
      OPTIMIZATION_MAP,
      { 'adset-1': 'COMPLETE_REGISTRATION' },
      '123',
      '456',
      LAST_7_DAYS
    );

    expect(last7Rows).toHaveLength(1);
  });

  it('keeps trial-optimized ads on the All Time window', () => {
    const row = makeRow({ results: 25, spend: '1000' });

    const allTimeRows = computeAdWinnerRows(
      [row],
      {},
      OPTIMIZATION_MAP,
      { 'adset-1': 'START_TRIAL' },
      '123',
      '456',
      ALL_TIME
    );

    expect(allTimeRows).toHaveLength(1);
  });
});

describe('toAdWinnerValues', () => {
  it('writes AD_NAME as a HYPERLINK formula and escapes embedded quotes', () => {
    const rows = computeAdWinnerRows(
      [makeRow({ ad_name: 'Sara - STATICS (Offer "NEW")', results: 5, spend: '100' })],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    const [[adNameCell]] = toAdWinnerValues(rows);

    expect(adNameCell).toBe(
      '=HYPERLINK("https://adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone?act=123&ads_manager_write_regions=true&business_id=456&selected_ad_ids=ad-1", "Sara - STATICS (Offer ""NEW"")")'
    );
  });

  it('appends a TOTAL row summing results/spend and deriving CPL from the totals', () => {
    const rows = computeAdWinnerRows(
      [
        makeRow({ ad_id: 'a', results: 5, spend: '500' }), // cpl 100
        makeRow({ ad_id: 'b', results: 3, spend: '600' }), // cpl 200
      ],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    const values = toAdWinnerValues(rows);
    const totalRow = values[values.length - 1];

    expect(totalRow).toEqual(['TOTAL', 8, 137.5, 1100, '', '']);
  });

  it('blanks CPL in the TOTAL row when there are zero total results', () => {
    const rows = computeAdWinnerRows(
      [makeRow({ results: 0, spend: '50' })],
      {},
      OPTIMIZATION_MAP,
      {},
      '123',
      '456',
      LAST_7_DAYS
    );

    const values = toAdWinnerValues(rows);

    expect(values[values.length - 1]).toEqual(['TOTAL', 0, '', 50, '', '']);
  });
});
