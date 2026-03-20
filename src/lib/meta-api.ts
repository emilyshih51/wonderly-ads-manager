const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

interface MetaApiOptions {
  method?: string;
  body?: Record<string, unknown> | FormData;
  params?: Record<string, string>;
}

export async function metaApi(endpoint: string, accessToken: string, options: MetaApiOptions = {}) {
  const { method = 'GET', body, params = {} } = options;

  const url = new URL(`${META_BASE_URL}${endpoint}`);

  url.searchParams.set('access_token', accessToken);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const fetchOptions: RequestInit = { method, cache: 'no-store' };

  if (body) {
    if (body instanceof FormData) {
      fetchOptions.body = body;
    } else {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url.toString(), fetchOptions);
  const data = await response.json();

  if (data.error) {
    const err: any = new Error(data.error.message || 'Meta API Error');

    err.metaError = data.error; // Preserve full Meta error object (error_subcode, error_user_title, etc.)
    throw err;
  }

  return data;
}

// Campaign operations
export async function getCampaigns(adAccountId: string, accessToken: string) {
  return metaApi(`/act_${adAccountId}/campaigns`, accessToken, {
    params: {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time',
      limit: '100',
    },
  });
}

export async function getCampaignInsights(
  campaignId: string,
  accessToken: string,
  datePreset: string = 'today'
) {
  return metaApi(`/${campaignId}/insights`, accessToken, {
    params: {
      fields:
        'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
    },
  });
}

export async function duplicateCampaign(
  campaignId: string,
  adAccountId: string,
  accessToken: string,
  newName?: string
) {
  // Get original campaign
  const original = await metaApi(`/${campaignId}`, accessToken, {
    params: {
      fields:
        'name,objective,status,daily_budget,lifetime_budget,special_ad_categories,buying_type',
    },
  });

  // Create copy
  const result = await metaApi(`/act_${adAccountId}/campaigns`, accessToken, {
    method: 'POST',
    body: {
      name: newName || `${original.name} (Copy)`,
      objective: original.objective,
      status: 'PAUSED',
      special_ad_categories: original.special_ad_categories || [],
      ...(original.daily_budget && { daily_budget: original.daily_budget }),
      ...(original.lifetime_budget && { lifetime_budget: original.lifetime_budget }),
    },
  });

  return result;
}

/**
 * Map Meta optimization_goal + promoted_object.custom_event_type to action_type.
 * This is how Meta determines what counts as a "Result" in its UI.
 */
const CUSTOM_EVENT_TO_ACTION_TYPE: Record<string, string> = {
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
 * Fetch all ad sets with their optimization_goal and promoted_object,
 * grouped by campaign_id. Returns a map of campaign_id → action_type
 * that should count as "Results" for that campaign.
 */
export async function getCampaignOptimizationMap(
  adAccountId: string,
  accessToken: string
): Promise<Record<string, string>> {
  const data = await metaApi(`/act_${adAccountId}/adsets`, accessToken, {
    params: {
      fields: 'campaign_id,optimization_goal,promoted_object',
      limit: '200',
    },
  });

  const map: Record<string, string> = {};

  for (const adset of data.data || []) {
    const campaignId = adset.campaign_id;

    if (map[campaignId]) continue; // Use first ad set per campaign

    const goal = adset.optimization_goal;
    const promoted = adset.promoted_object;

    if (goal === 'OFFSITE_CONVERSIONS' && promoted?.custom_event_type) {
      const actionType = CUSTOM_EVENT_TO_ACTION_TYPE[promoted.custom_event_type];

      if (actionType) {
        map[campaignId] = actionType;
      } else {
        // Unknown custom event — use fb_pixel_ prefix
        map[campaignId] = `offsite_conversion.fb_pixel_${promoted.custom_event_type.toLowerCase()}`;
      }
    } else if (goal === 'OFFSITE_CONVERSIONS' && promoted?.custom_conversion_id) {
      // Custom conversion — use the custom conversion ID format
      map[campaignId] = `offsite_conversion.custom.${promoted.custom_conversion_id}`;
    } else if (goal === 'LEAD_GENERATION') {
      map[campaignId] = 'onsite_conversion.lead_grouped';
    } else if (goal === 'CONVERSATIONS') {
      map[campaignId] = 'onsite_conversion.messaging_conversation_started_7d';
    }
    // For other goals (LINK_CLICKS, REACH, etc.) we don't map — those aren't conversion results
  }

  return map;
}

// Ad Set operations
export async function getAdSets(adAccountId: string, accessToken: string, campaignId?: string) {
  const endpoint = campaignId ? `/${campaignId}/adsets` : `/act_${adAccountId}/adsets`;

  return metaApi(endpoint, accessToken, {
    params: {
      fields:
        'id,name,campaign_id,campaign{name},status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,created_time,updated_time',
      limit: '100',
    },
  });
}

export async function duplicateAdSet(
  adSetId: string,
  adAccountId: string,
  accessToken: string,
  newName?: string,
  targetCampaignId?: string
) {
  // Get original ad set with all settings
  const original = await metaApi(`/${adSetId}`, accessToken, {
    params: {
      fields:
        'name,campaign_id,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,promoted_object',
    },
  });

  const body: Record<string, unknown> = {
    name: newName || `${original.name} (Copy)`,
    campaign_id: targetCampaignId || original.campaign_id,
    status: 'PAUSED',
    targeting: original.targeting,
    optimization_goal: original.optimization_goal,
    billing_event: original.billing_event,
  };

  if (original.daily_budget) body.daily_budget = original.daily_budget;
  if (original.lifetime_budget) body.lifetime_budget = original.lifetime_budget;
  if (original.bid_amount) body.bid_amount = original.bid_amount;
  if (original.promoted_object) body.promoted_object = original.promoted_object;

  const result = await metaApi(`/act_${adAccountId}/adsets`, accessToken, {
    method: 'POST',
    body,
  });

  return result;
}

// Ad operations
export async function getAds(adAccountId: string, accessToken: string, adSetId?: string) {
  const endpoint = adSetId ? `/${adSetId}/ads` : `/act_${adAccountId}/ads`;

  return metaApi(endpoint, accessToken, {
    params: {
      fields:
        'id,name,adset_id,campaign_id,status,creative{id,name,title,body,image_url,thumbnail_url,link_url,call_to_action_type},created_time,updated_time',
      limit: '100',
    },
  });
}

export async function getAdInsights(
  adId: string,
  accessToken: string,
  datePreset: string = 'today'
) {
  return metaApi(`/${adId}/insights`, accessToken, {
    params: {
      fields:
        'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
    },
  });
}

// Upload ad image
export async function uploadAdImage(adAccountId: string, accessToken: string, imageFile: File) {
  const formData = new FormData();

  formData.append('filename', imageFile);
  formData.append('access_token', accessToken);

  const response = await fetch(`${META_BASE_URL}/act_${adAccountId}/adimages`, {
    method: 'POST',
    body: formData,
  });

  return response.json();
}

// Create ad creative
export async function createAdCreative(
  adAccountId: string,
  accessToken: string,
  creative: {
    name: string;
    pageId: string;
    imageHash?: string;
    videoId?: string;
    message: string;
    link: string;
    headline: string;
    description?: string;
    callToAction: string;
  }
) {
  const objectStorySpec: Record<string, unknown> = {
    page_id: creative.pageId,
    link_data: {
      message: creative.message,
      link: creative.link,
      name: creative.headline,
      ...(creative.description && { description: creative.description }),
      ...(creative.imageHash && { image_hash: creative.imageHash }),
      call_to_action: { type: creative.callToAction },
    },
  };

  return metaApi(`/act_${adAccountId}/adcreatives`, accessToken, {
    method: 'POST',
    body: {
      name: creative.name,
      object_story_spec: objectStorySpec,
    },
  });
}

// Create ad
export async function createAd(
  adAccountId: string,
  accessToken: string,
  ad: {
    name: string;
    adsetId: string;
    creativeId: string;
    status?: string;
  }
) {
  return metaApi(`/act_${adAccountId}/ads`, accessToken, {
    method: 'POST',
    body: {
      name: ad.name,
      adset_id: ad.adsetId,
      creative: { creative_id: ad.creativeId },
      status: ad.status || 'PAUSED',
    },
  });
}

/**
 * Duplicate an ad to a different ad set.
 * Fetches the original ad's creative and creates a new ad in the target ad set.
 */
export async function duplicateAd(
  adId: string,
  targetAdSetId: string,
  adAccountId: string,
  accessToken: string,
  newName?: string
): Promise<{ id: string }> {
  // Get the original ad to find its creative
  const original = await metaApi(`/${adId}`, accessToken, {
    params: { fields: 'name,creative{id}' },
  });

  const creativeId = original.creative?.id;

  if (!creativeId) throw new Error(`Ad ${adId} has no creative`);

  const name = newName || `${original.name} [Winner Copy]`;

  // Create a new ad in the target ad set using the same creative
  const result = await metaApi(`/act_${adAccountId}/ads`, accessToken, {
    method: 'POST',
    body: {
      name,
      adset_id: targetAdSetId,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
    },
  });

  return { id: result.id };
}

// Update status (for automations)
export async function updateStatus(
  objectId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED'
) {
  return metaApi(`/${objectId}`, accessToken, {
    method: 'POST',
    body: { status },
  });
}

// Account-level insights
export async function getAccountInsights(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'today',
  timeIncrement?: string
) {
  const params: Record<string, string> = {
    fields:
      'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
    date_preset: datePreset,
  };

  if (timeIncrement) params.time_increment = timeIncrement;

  return metaApi(`/act_${adAccountId}/insights`, accessToken, { params });
}

/**
 * Get insights broken down by campaign in ONE API call.
 * Uses level=campaign so Meta returns one row per campaign.
 * This avoids N separate API calls and rate limiting.
 */
export async function getCampaignLevelInsights(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'today'
) {
  return metaApi(`/act_${adAccountId}/insights`, accessToken, {
    params: {
      fields:
        'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
      level: 'campaign',
      limit: '100',
    },
  });
}

/**
 * Get insights broken down by ad set in ONE API call.
 * Uses level=adset so Meta returns one row per ad set.
 */
export async function getAdSetLevelInsights(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'today'
) {
  return metaApi(`/act_${adAccountId}/insights`, accessToken, {
    params: {
      fields:
        'adset_id,adset_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
      level: 'adset',
      limit: '200',
    },
  });
}

/**
 * Get insights broken down by ad in ONE API call.
 */
export async function getAdLevelInsights(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'today'
) {
  return metaApi(`/act_${adAccountId}/insights`, accessToken, {
    params: {
      fields:
        'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
      level: 'ad',
      limit: '200',
    },
  });
}

/**
 * Get insights with daily time increment for trend analysis.
 * Returns one row per day per entity.
 */
export async function getDailyInsights(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'last_7d',
  level: 'account' | 'campaign' | 'adset' | 'ad' = 'campaign'
) {
  const params: Record<string, string> = {
    fields: [
      level === 'campaign' ? 'campaign_id,campaign_name' : '',
      level === 'adset' ? 'adset_id,adset_name,campaign_id' : '',
      level === 'ad' ? 'ad_id,ad_name,adset_id,campaign_id' : '',
      'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
    ]
      .filter(Boolean)
      .join(','),
    date_preset: datePreset,
    time_increment: '1', // daily breakdown
    limit: '500',
  };

  if (level !== 'account') params.level = level;

  return metaApi(`/act_${adAccountId}/insights`, accessToken, { params });
}

/**
 * Get insights with breakdowns (age, gender, device, placement, etc.)
 */
export async function getInsightsWithBreakdowns(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'today',
  breakdowns: string = 'age,gender'
) {
  return metaApi(`/act_${adAccountId}/insights`, accessToken, {
    params: {
      fields:
        'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
      breakdowns,
      limit: '200',
    },
  });
}

/**
 * Get insights for a specific date range using start/end dates.
 * Useful for "yesterday" comparisons.
 */
export async function getInsightsForDateRange(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
  level: 'account' | 'campaign' | 'adset' | 'ad' = 'campaign'
) {
  const params: Record<string, string> = {
    fields: [
      level === 'campaign' ? 'campaign_id,campaign_name' : '',
      level === 'adset' ? 'adset_id,adset_name,campaign_id' : '',
      level === 'ad' ? 'ad_id,ad_name,adset_id,campaign_id' : '',
      'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
    ]
      .filter(Boolean)
      .join(','),
    time_range: JSON.stringify({ since, until }),
    limit: '500',
  };

  if (level !== 'account') params.level = level;

  return metaApi(`/act_${adAccountId}/insights`, accessToken, { params });
}

/**
 * Get hourly insights using Meta's hourly breakdown.
 * Returns one row per hour with `hourly_stats_aggregated_by_advertiser_time_zone` field (0-23).
 * Works for today/yesterday only.
 */
export async function getHourlyInsights(
  adAccountId: string,
  accessToken: string,
  datePreset: string = 'today',
  level: string = 'account'
) {
  return metaApi(`/act_${adAccountId}/insights`, accessToken, {
    params: {
      fields:
        'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      date_preset: datePreset,
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
      level,
      limit: '200',
    },
  });
}

/**
 * Get hourly insights for a specific date range (e.g. yesterday).
 */
export async function getHourlyInsightsForDate(
  adAccountId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string,
  level: string = 'account'
) {
  return metaApi(`/act_${adAccountId}/insights`, accessToken, {
    params: {
      fields:
        'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks,date_start,date_stop',
      time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
      level,
      limit: '200',
    },
  });
}

// Get ad account info
export async function getAdAccount(adAccountId: string, accessToken: string) {
  return metaApi(`/act_${adAccountId}`, accessToken, {
    params: {
      fields: 'id,name,account_status,currency,timezone_name,amount_spent',
    },
  });
}
