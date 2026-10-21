import { describe, it, expect } from 'vitest';

import { buildAdsManagerPerformanceLink } from '@/lib/ads-manager-link';

const NAME = 'Zsombor - AIVIDS - June Batch 1 - Remodeling - 3.3 (Offer) [Winner Copy]';
// A real Ads Manager link for this ad, as opened from Ads Manager itself.
const REAL_LINK =
  'https://adsmanager.facebook.com/adsmanager/manage/ads?act=1403742814420018&business_id=1630682394838664&filter_set=SEARCH_BY_ADGROUP_NAME-STRING%1ECONTAINS_ALL%1E%22[%5C%22Zsombor%20-%20AIVIDS%20-%20June%20Batch%201%20-%20Remodeling%20-%203.3%20(Offer)%20[Winner%20Copy]%5C%22]%22&global_scope_id=1630682394838664&nav_source=ads_manager&selected_ad_ids=120247445493780408&treenav=true&columns=name%2Cdelivery%2Crecommendations_guidance%2Cattribution_setting%2Cresults%2Ccost_per_result%2Cbudget%2Cspend%2Cimpressions%2Creach%2Cfrequency%2Ccpm%2Cactions%3Aomni_purchase%2Cschedule%2Cend_time%2Cbid%2Clast_significant_edit%2Cquality_score_organic%2Cquality_score_ectr%2Cquality_score_ecvr%2Ccampaign_name%2Cpurchase_roas%3Aomni_purchase&attribution_windows=default';

/** Query params of a URL, fully decoded (handles the literal %1E in filter_set). */
function params(link: string): Record<string, string> {
  const query = link.split('?')[1];

  return Object.fromEntries(
    query.split('&').map((pair) => {
      const [k, v] = pair.split('=');

      return [k, decodeURIComponent(v)];
    })
  );
}

describe('buildAdsManagerPerformanceLink', () => {
  const link = buildAdsManagerPerformanceLink(
    '1403742814420018',
    '1630682394838664',
    '120247445493780408',
    NAME
  );

  it('opens the Ads table, not the standalone edit view', () => {
    expect(link.startsWith('https://adsmanager.facebook.com/adsmanager/manage/ads?')).toBe(true);
  });

  it('matches a real Ads Manager link, plus a lifetime date range', () => {
    expect(params(link)).toEqual({ ...params(REAL_LINK), date_preset: 'maximum' });
  });

  it('filters by the exact ad name', () => {
    expect(params(link).filter_set).toBe(
      `SEARCH_BY_ADGROUP_NAME-STRING\u001ECONTAINS_ALL\u001E"[\\"${NAME}\\"]"`
    );
  });

  it('takes a different date range', () => {
    expect(params(buildAdsManagerPerformanceLink('1', '2', '3', 'x', 'last_7d')).date_preset).toBe(
      'last_7d'
    );
  });
});
