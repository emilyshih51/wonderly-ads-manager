/**
 * MetaService — typed wrapper around the Meta (Facebook) Graph API v21.0.
 *
 * Encapsulates credentials and provides strongly-typed methods for all
 * campaign, ad set, ad, creative, and insights operations used by the app.
 *
 * @example
 * ```ts
 * const meta = new MetaService(session.meta_access_token, session.ad_account_id);
 * const campaigns = await meta.getCampaigns();
 * ```
 */

import {
  META_BASE_URL,
  INSIGHT_FIELDS,
  INSIGHT_DETAIL_FIELDS,
  CUSTOM_EVENT_TO_ACTION_TYPE,
} from './constants';
import type {
  MetaRequestOptions,
  MetaApiError,
  InsightLevel,
  CreateAdCreativeParams,
  CreateAdParams,
  IMetaService,
} from './types';

export type {
  MetaRequestOptions,
  MetaApiError,
  InsightLevel,
  CreateAdCreativeParams,
  CreateAdParams,
  IMetaService,
};

export class MetaService implements IMetaService {
  constructor(
    private readonly accessToken: string,
    private readonly adAccountId: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /**
   * Make a request to the Meta Graph API.
   *
   * @param endpoint - API path, e.g. `/act_123/campaigns`
   * @param options - Method, body, and query params
   * @throws {MetaApiError} When Meta returns an error object
   */
  async request(endpoint: string, options: MetaRequestOptions = {}): Promise<unknown> {
    const { method = 'GET', body, params = {} } = options;
    const url = new URL(`${META_BASE_URL}${endpoint}`);

    url.searchParams.set('access_token', this.accessToken);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const fetchOptions: RequestInit = { method, cache: 'no-store' };

    if (body) {
      if (body instanceof FormData) {
        fetchOptions.body = body;
      } else {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await this.fetchFn(url.toString(), fetchOptions);
    const data = (await response.json()) as Record<string, unknown>;

    if (data.error) {
      const errorData = data.error as MetaApiError['metaError'];
      const err = new Error(errorData.message || 'Meta API Error') as MetaApiError;

      err.metaError = errorData;
      throw err;
    }

    return data;
  }

  /**
   * List all campaigns for the ad account.
   *
   * @returns Paginated list of campaigns with status, budget, and dates
   */
  async getCampaigns(): Promise<{ data: unknown[] }> {
    return this.request(`/act_${this.adAccountId}/campaigns`, {
      params: {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time',
        limit: '100',
      },
    }) as Promise<{ data: unknown[] }>;
  }

  /**
   * Get performance insights for a single campaign.
   *
   * @param campaignId - Meta campaign ID
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getCampaignInsights(campaignId: string, datePreset = 'today'): Promise<unknown> {
    return this.request(`/${campaignId}/insights`, {
      params: { fields: INSIGHT_FIELDS, date_preset: datePreset },
    });
  }

  /**
   * Duplicate a campaign, creating a paused copy.
   *
   * @param campaignId - Source campaign ID
   * @param newName - Optional name override (defaults to `"<original> (Copy)"`)
   */
  async duplicateCampaign(campaignId: string, newName?: string): Promise<unknown> {
    const original = (await this.request(`/${campaignId}`, {
      params: {
        fields:
          'name,objective,status,daily_budget,lifetime_budget,special_ad_categories,buying_type',
      },
    })) as Record<string, unknown>;

    return this.request(`/act_${this.adAccountId}/campaigns`, {
      method: 'POST',
      body: {
        name: newName || `${original.name} (Copy)`,
        objective: original.objective,
        status: 'PAUSED',
        special_ad_categories: (original.special_ad_categories as string[]) || [],
        ...(original.daily_budget ? { daily_budget: original.daily_budget as string } : {}),
        ...(original.lifetime_budget
          ? { lifetime_budget: original.lifetime_budget as string }
          : {}),
      },
    });
  }

  /**
   * Build a map of campaign ID → Meta action type used to count "Results".
   *
   * Meta's "Results" metric depends on the optimization goal of the ad sets
   * within each campaign. Fetches all ad sets and returns a lookup map so
   * callers can resolve the correct `action_type` per campaign.
   *
   * @returns `{ [campaignId]: actionType }` e.g. `{ "123": "offsite_conversion.fb_pixel_lead" }`
   */
  async getCampaignOptimizationMap(): Promise<Record<string, string>> {
    const data = (await this.request(`/act_${this.adAccountId}/adsets`, {
      params: { fields: 'campaign_id,optimization_goal,promoted_object', limit: '200' },
    })) as { data?: Array<Record<string, unknown>> };

    const map: Record<string, string> = {};

    for (const adset of data.data || []) {
      const campaignId = adset.campaign_id as string;

      if (map[campaignId]) continue;

      const goal = adset.optimization_goal as string;
      const promoted = adset.promoted_object as Record<string, string> | undefined;

      if (goal === 'OFFSITE_CONVERSIONS' && promoted?.custom_event_type) {
        const actionType = CUSTOM_EVENT_TO_ACTION_TYPE[promoted.custom_event_type];

        map[campaignId] = actionType
          ? actionType
          : `offsite_conversion.fb_pixel_${promoted.custom_event_type.toLowerCase()}`;
      } else if (goal === 'OFFSITE_CONVERSIONS' && promoted?.custom_conversion_id) {
        map[campaignId] = `offsite_conversion.custom.${promoted.custom_conversion_id}`;
      } else if (goal === 'LEAD_GENERATION') {
        map[campaignId] = 'onsite_conversion.lead_grouped';
      } else if (goal === 'CONVERSATIONS') {
        map[campaignId] = 'onsite_conversion.messaging_conversation_started_7d';
      }
    }

    return map;
  }

  /**
   * List ad sets, optionally filtered by campaign.
   *
   * @param campaignId - When provided, only returns ad sets for this campaign
   */
  async getAdSets(campaignId?: string): Promise<{ data: unknown[] }> {
    const endpoint = campaignId ? `/${campaignId}/adsets` : `/act_${this.adAccountId}/adsets`;

    return this.request(endpoint, {
      params: {
        fields:
          'id,name,campaign_id,campaign{name},status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,created_time,updated_time',
        limit: '100',
      },
    }) as Promise<{ data: unknown[] }>;
  }

  /**
   * Duplicate an ad set into the same or a different campaign.
   *
   * @param adSetId - Source ad set ID
   * @param newName - Optional name override (defaults to `"<original> (Copy)"`)
   * @param targetCampaignId - Target campaign (defaults to source campaign)
   */
  async duplicateAdSet(
    adSetId: string,
    newName?: string,
    targetCampaignId?: string
  ): Promise<unknown> {
    const original = (await this.request(`/${adSetId}`, {
      params: {
        fields:
          'name,campaign_id,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,promoted_object',
      },
    })) as Record<string, unknown>;

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

    return this.request(`/act_${this.adAccountId}/adsets`, { method: 'POST', body });
  }

  /**
   * List ads, optionally filtered by ad set.
   *
   * @param adSetId - When provided, only returns ads for this ad set
   */
  async getAds(adSetId?: string): Promise<{ data: unknown[] }> {
    const endpoint = adSetId ? `/${adSetId}/ads` : `/act_${this.adAccountId}/ads`;

    return this.request(endpoint, {
      params: {
        fields:
          'id,name,adset_id,campaign_id,status,creative{id,name,title,body,image_url,thumbnail_url,link_url,call_to_action_type},created_time,updated_time',
        limit: '100',
      },
    }) as Promise<{ data: unknown[] }>;
  }

  /**
   * Get performance insights for a single ad.
   *
   * @param adId - Meta ad ID
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getAdInsights(adId: string, datePreset = 'today'): Promise<unknown> {
    return this.request(`/${adId}/insights`, {
      params: { fields: INSIGHT_FIELDS, date_preset: datePreset },
    });
  }

  /**
   * Upload an image to the ad account's image library.
   *
   * @param imageFile - Image file to upload
   * @returns Image hash and metadata from Meta
   */
  async uploadAdImage(imageFile: File): Promise<unknown> {
    const formData = new FormData();

    formData.append('filename', imageFile);
    formData.append('access_token', this.accessToken);

    const response = await this.fetchFn(`${META_BASE_URL}/act_${this.adAccountId}/adimages`, {
      method: 'POST',
      body: formData,
    });

    return response.json();
  }

  /**
   * Create an ad creative with image/video and copy.
   *
   * @param creative - Creative parameters including page ID, link, and call-to-action
   */
  async createAdCreative(creative: CreateAdCreativeParams): Promise<unknown> {
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

    return this.request(`/act_${this.adAccountId}/adcreatives`, {
      method: 'POST',
      body: { name: creative.name, object_story_spec: objectStorySpec },
    });
  }

  /**
   * Create an ad from an existing creative.
   *
   * @param ad - Ad name, target ad set, creative ID, and optional status
   */
  async createAd(ad: CreateAdParams): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/ads`, {
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
   * Duplicate an ad to a different ad set using the same creative.
   *
   * @param adId - Source ad ID
   * @param targetAdSetId - Ad set to place the duplicate in
   * @param newName - Optional name override (defaults to `"<original> [Winner Copy]"`)
   * @returns `{ id }` of the newly created ad
   * @throws When the source ad has no creative
   */
  async duplicateAd(
    adId: string,
    targetAdSetId: string,
    newName?: string
  ): Promise<{ id: string }> {
    const original = (await this.request(`/${adId}`, {
      params: { fields: 'name,creative{id}' },
    })) as { name: string; creative?: { id: string } };

    const creativeId = original.creative?.id;

    if (!creativeId) throw new Error(`Ad ${adId} has no creative`);

    const result = (await this.request(`/act_${this.adAccountId}/ads`, {
      method: 'POST',
      body: {
        name: newName || `${original.name} [Winner Copy]`,
        adset_id: targetAdSetId,
        creative: { creative_id: creativeId },
        status: 'ACTIVE',
      },
    })) as { id: string };

    return { id: result.id };
  }

  /**
   * Pause or activate a campaign, ad set, or ad.
   *
   * @param objectId - Meta object ID (campaign, ad set, or ad)
   * @param status - `'ACTIVE'` or `'PAUSED'`
   */
  async updateStatus(objectId: string, status: 'ACTIVE' | 'PAUSED'): Promise<unknown> {
    return this.request(`/${objectId}`, { method: 'POST', body: { status } });
  }

  /**
   * Get account-level performance insights.
   *
   * @param datePreset - Date range preset (default: `'today'`)
   * @param timeIncrement - Optional time breakdown, e.g. `'1'` for daily
   */
  async getAccountInsights(datePreset = 'today', timeIncrement?: string): Promise<unknown> {
    const params: Record<string, string> = { fields: INSIGHT_FIELDS, date_preset: datePreset };

    if (timeIncrement) params.time_increment = timeIncrement;

    return this.request(`/act_${this.adAccountId}/insights`, { params });
  }

  /**
   * Get insights broken down by campaign (`level=campaign`).
   *
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getCampaignLevelInsights(datePreset = 'today'): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/insights`, {
      params: {
        fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`,
        date_preset: datePreset,
        level: 'campaign',
        limit: '100',
      },
    });
  }

  /**
   * Get insights broken down by ad set (`level=adset`).
   *
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getAdSetLevelInsights(datePreset = 'today'): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/insights`, {
      params: {
        fields: `adset_id,adset_name,campaign_id,${INSIGHT_FIELDS}`,
        date_preset: datePreset,
        level: 'adset',
        limit: '200',
      },
    });
  }

  /**
   * Get insights broken down by ad (`level=ad`).
   *
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getAdLevelInsights(datePreset = 'today'): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/insights`, {
      params: {
        fields: `ad_id,ad_name,adset_id,campaign_id,${INSIGHT_FIELDS}`,
        date_preset: datePreset,
        level: 'ad',
        limit: '200',
      },
    });
  }

  /**
   * Get daily time-increment insights for trend analysis.
   *
   * @param datePreset - Date range preset (default: `'last_7d'`)
   * @param level - Breakdown level (default: `'campaign'`)
   */
  async getDailyInsights(
    datePreset = 'last_7d',
    level: InsightLevel = 'campaign'
  ): Promise<unknown> {
    const detail = INSIGHT_DETAIL_FIELDS[level] ?? '';
    const fields = [detail, INSIGHT_FIELDS, 'frequency'].filter(Boolean).join(',');
    const params: Record<string, string> = {
      fields,
      date_preset: datePreset,
      time_increment: '1',
      limit: '500',
    };

    if (level !== 'account') params.level = level;

    return this.request(`/act_${this.adAccountId}/insights`, { params });
  }

  /**
   * Get insights with audience or device breakdowns.
   *
   * @param datePreset - Date range preset (default: `'today'`)
   * @param breakdowns - Comma-separated breakdown list (default: `'age,gender'`)
   */
  async getInsightsWithBreakdowns(
    datePreset = 'today',
    breakdowns = 'age,gender'
  ): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/insights`, {
      params: { fields: INSIGHT_FIELDS, date_preset: datePreset, breakdowns, limit: '200' },
    });
  }

  /**
   * Get insights for a specific date range using `since`/`until` dates.
   *
   * @param since - Start date in `YYYY-MM-DD` format
   * @param until - End date in `YYYY-MM-DD` format
   * @param level - Breakdown level (default: `'campaign'`)
   */
  async getInsightsForDateRange(
    since: string,
    until: string,
    level: InsightLevel = 'campaign'
  ): Promise<unknown> {
    const detail = INSIGHT_DETAIL_FIELDS[level] ?? '';
    const fields = [detail, INSIGHT_FIELDS, 'frequency'].filter(Boolean).join(',');
    const params: Record<string, string> = {
      fields,
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    };

    if (level !== 'account') params.level = level;

    return this.request(`/act_${this.adAccountId}/insights`, { params });
  }

  /**
   * Get hourly insights using Meta's hourly stats breakdown.
   * Only works for `'today'` or `'yesterday'` date presets.
   *
   * @param datePreset - Date range preset (default: `'today'`)
   * @param level - Breakdown level (default: `'account'`)
   */
  async getHourlyInsights(datePreset = 'today', level = 'account'): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/insights`, {
      params: {
        fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`,
        date_preset: datePreset,
        breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        level,
        limit: '200',
      },
    });
  }

  /**
   * Get hourly insights for a specific date range (e.g. yesterday's hours).
   *
   * @param dateStart - Start date in `YYYY-MM-DD` format
   * @param dateEnd - End date in `YYYY-MM-DD` format
   * @param level - Breakdown level (default: `'account'`)
   */
  async getHourlyInsightsForDate(
    dateStart: string,
    dateEnd: string,
    level = 'account'
  ): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}/insights`, {
      params: {
        fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`,
        time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
        breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        level,
        limit: '200',
      },
    });
  }

  /**
   * Get ad account info: name, status, currency, timezone, and amount spent.
   */
  async getAdAccount(): Promise<unknown> {
    return this.request(`/act_${this.adAccountId}`, {
      params: { fields: 'id,name,account_status,currency,timezone_name,amount_spent' },
    });
  }
}
