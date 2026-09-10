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
