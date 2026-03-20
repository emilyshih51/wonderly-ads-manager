/** Meta Graph API version used for all requests (e.g. `/v21.0/`). */
export const META_API_VERSION = 'v21.0';

/** Base URL for all Meta Graph API requests (e.g. `https://graph.facebook.com/v21.0`). */
export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

/** Facebook OAuth dialog base URL — used to initiate the user OAuth flow. */
export const META_OAUTH_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;

// ─── Filtered Insights Field Lists ───────────────────────────────────────────
// Used by getFilteredInsights() and the automation evaluation/search engine.

/**
 * Insight fields requested for ad-level queries.
 * Includes entity IDs, core performance metrics, and the actions breakdown
 * needed for result counting.
 */
export const INSIGHT_FIELDS_AD =
  'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type';

/**
 * Insight fields requested for ad-set-level queries.
 * Includes campaign context fields so callers can group by campaign without
 * a separate lookup.
 */
export const INSIGHT_FIELDS_ADSET =
  'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type';

/**
 * Insight fields requested for campaign-level queries.
 * Core performance metrics plus actions breakdown for result counting.
 */
export const INSIGHT_FIELDS_CAMPAIGN =
  'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type';

/**
 * Pre-serialized Meta API `filtering` parameter strings for each entity level.
 * Restricts results to entities with `effective_status = ACTIVE`, preventing
 * stale paused-entity data from triggering false automation actions.
 *
 * @example
 * ```ts
 * meta.request('/act_123/insights', { params: { filtering: ACTIVE_FILTER.ad } });
 * ```
 */
export const ACTIVE_FILTER = {
  ad: JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }]),
  adset: JSON.stringify([{ field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }]),
  campaign: JSON.stringify([
    { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] },
  ]),
} as const;

/**
 * Standard insight fields used by account/campaign/ad-set/ad overview queries.
 * Includes spend, delivery, click, and conversion metrics plus date range bounds.
 */
export const INSIGHT_FIELDS =
  'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop';

/**
 * Maps Meta ad set `optimization_goal` + `promoted_object.custom_event_type` values
 * to the corresponding `action_type` string used in the Insights API `actions` array.
 *
 * Used by `getCampaignOptimizationMap()` to resolve which action type counts as a
 * "Result" for a given campaign, matching the logic in Meta Ads Manager.
 *
 * @example
 * ```ts
 * CUSTOM_EVENT_TO_ACTION_TYPE['LEAD'] // → 'offsite_conversion.fb_pixel_lead'
 * ```
 */
export const CUSTOM_EVENT_TO_ACTION_TYPE: Record<string, string> = {
  COMPLETE_REGISTRATION: 'offsite_conversion.fb_pixel_complete_registration',
  LEAD: 'offsite_conversion.fb_pixel_lead',
  PURCHASE: 'offsite_conversion.fb_pixel_purchase',
  ADD_TO_CART: 'offsite_conversion.fb_pixel_add_to_cart',
  INITIATE_CHECKOUT: 'offsite_conversion.fb_pixel_initiate_checkout',
  START_TRIAL: 'offsite_conversion.fb_pixel_start_trial',
  SUBSCRIBE: 'offsite_conversion.fb_pixel_subscribe',
  ADD_PAYMENT_INFO: 'offsite_conversion.fb_pixel_add_payment_info',
  SEARCH: 'offsite_conversion.fb_pixel_search',
  VIEW_CONTENT: 'offsite_conversion.fb_pixel_view_content',
  CONTACT: 'offsite_conversion.fb_pixel_contact',
  FIND_LOCATION: 'offsite_conversion.fb_pixel_find_location',
  SCHEDULE: 'offsite_conversion.fb_pixel_schedule',
  SUBMIT_APPLICATION: 'offsite_conversion.fb_pixel_submit_application',
  OTHER: 'offsite_conversion.fb_pixel_custom',
};

/**
 * Entity-level ID and name fields prepended to insight queries that use a
 * `level` parameter. Keyed by `InsightLevel` (`'campaign'`, `'adset'`, `'ad'`,
 * `'account'`). The `'account'` level has no detail fields (empty string).
 *
 * @example
 * ```ts
 * const fields = [INSIGHT_DETAIL_FIELDS['campaign'], INSIGHT_FIELDS].join(',');
 * // → 'campaign_id,campaign_name,spend,impressions,...'
 * ```
 */
export const INSIGHT_DETAIL_FIELDS: Record<string, string> = {
  campaign: 'campaign_id,campaign_name',
  adset: 'adset_id,adset_name,campaign_id',
  ad: 'ad_id,ad_name,adset_id,campaign_id',
  account: '',
};
