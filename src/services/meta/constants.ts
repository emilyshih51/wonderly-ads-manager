export const META_API_VERSION = 'v21.0';

export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export const INSIGHT_FIELDS =
  'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop';

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

export const INSIGHT_DETAIL_FIELDS: Record<string, string> = {
  campaign: 'campaign_id,campaign_name',
  adset: 'adset_id,adset_name,campaign_id',
  ad: 'ad_id,ad_name,adset_id,campaign_id',
  account: '',
};
