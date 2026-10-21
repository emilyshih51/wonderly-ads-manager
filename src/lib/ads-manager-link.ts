/**
 * Builds a Meta Ads Manager deep link that opens directly to one ad's standalone edit view.
 *
 * Used by the Ad Winners sheet so every ad name links straight into Ads Manager instead of
 * being plain text. Matches the exact link shape Ads Manager itself generates when you
 * open an ad from the account (confirmed against a real link pulled from the sheet):
 *
 * ```
 * https://adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone
 *   ?act=<adAccountId>&ads_manager_write_regions=true&business_id=<businessId>&selected_ad_ids=<adId>
 * ```
 *
 * `/manage/ads/edit/standalone` (not the plain `/manage/ads` list view) is what takes you
 * straight to the ad rather than to the filtered list with it merely selected;
 * `ads_manager_write_regions=true` and `business_id` are part of that same real link and are
 * reproduced as-is rather than guessed at.
 *
 * @param adAccountId - Meta ad account ID, without the `act_` prefix
 * @param businessId - Meta Business Manager ID that owns the ad account (see
 *   `WONDERLY_BUSINESS_ID` in `growth-config.ts`)
 * @param adId - Meta ad ID to open
 * @returns A URL that opens Ads Manager's standalone edit view for this one ad
 */
export function buildAdsManagerAdLink(
  adAccountId: string,
  businessId: string,
  adId: string
): string {
  const url = new URL('https://adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone');

  url.searchParams.set('act', adAccountId);
  url.searchParams.set('ads_manager_write_regions', 'true');
  url.searchParams.set('business_id', businessId);
  url.searchParams.set('selected_ad_ids', adId);

  return url.toString();
}

/**
 * Columns shown by the performance link — Ads Manager's own "Performance" column set
 * (delivery, results, cost per result, spend, reach, frequency, CPM, …), copied from a real
 * Ads Manager link so the view opens with the numbers that matter instead of whatever column
 * preset the viewer last used.
 */
const PERFORMANCE_COLUMNS = [
  'name',
  'delivery',
  'recommendations_guidance',
  'attribution_setting',
  'results',
  'cost_per_result',
  'budget',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'cpm',
  'actions:omni_purchase',
  'schedule',
  'end_time',
  'bid',
  'last_significant_edit',
  'quality_score_organic',
  'quality_score_ectr',
  'quality_score_ecvr',
  'campaign_name',
  'purchase_roas:omni_purchase',
].join(',');

/**
 * Builds a Meta Ads Manager link that opens the Ads table filtered to one ad by name, with
 * that ad selected — the same view the automation rule notifications in Slack link to, where
 * you can read the ad's results, cost per result and spend at a glance. (The standalone edit
 * view from `buildAdsManagerAdLink` opens the ad's settings instead of its numbers.)
 *
 * Several ads can share a name (e.g. a `[Winner Copy]` in more than one campaign); they all
 * show up in the filtered table, with `adId` the one selected.
 *
 * @param adAccountId - Meta ad account ID, without the `act_` prefix
 * @param businessId - Meta Business Manager ID that owns the ad account
 * @param adId - Meta ad ID to select
 * @param adName - The ad's exact name, used for the name filter
 * @param datePreset - Ads Manager date range (default `maximum`, i.e. lifetime — what the
 *   auto-pause rules judge on)
 * @returns A URL that opens Ads Manager's Ads table filtered to this ad
 */
export function buildAdsManagerPerformanceLink(
  adAccountId: string,
  businessId: string,
  adId: string,
  adName: string,
  datePreset = 'maximum'
): string {
  const url = new URL('https://adsmanager.facebook.com/adsmanager/manage/ads');

  url.searchParams.set('act', adAccountId);
  url.searchParams.set('business_id', businessId);
  url.searchParams.set('global_scope_id', businessId);
  url.searchParams.set('nav_source', 'ads_manager');
  url.searchParams.set('selected_ad_ids', adId);
  url.searchParams.set('treenav', 'true');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('columns', PERFORMANCE_COLUMNS);
  url.searchParams.set('attribution_windows', 'default');

  // filter_set uses literal %1E separators that URLSearchParams would double-encode, so it's
  // appended by hand (same as SlackService.buildAdManagerLink).
  const encodedName = encodeURIComponent(`"[\\"${adName}\\"]"`);

  return `${url.toString()}&filter_set=SEARCH_BY_ADGROUP_NAME-STRING%1ECONTAINS_ALL%1E${encodedName}`;
}
