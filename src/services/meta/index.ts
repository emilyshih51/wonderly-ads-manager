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
  META_OAUTH_URL,
  INSIGHT_FIELDS,
  INSIGHT_DETAIL_FIELDS,
  INSIGHT_FIELDS_AD,
  INSIGHT_FIELDS_ADSET,
  INSIGHT_FIELDS_CAMPAIGN,
  ACTIVE_FILTER,
} from './constants';

export { META_OAUTH_URL };
import {
  MetaApiError,
  type MetaRequestOptions,
  type InsightLevel,
  type CreateAdCreativeParams,
  type CreateAdParams,
  type MetaImageUploadResponse,
  type MetaVideoUploadResponse,
  type MetaAdAccountInfo,
} from './types';
import type { MetaCampaign, MetaAdSet, MetaAd, MetaInsightsRow, UserSession } from '@/types';

export { MetaApiError };
export type {
  MetaRequestOptions,
  InsightLevel,
  CreateAdCreativeParams,
  CreateAdParams,
  MetaImageUploadResponse,
  MetaVideoUploadResponse,
  MetaAdAccountInfo,
};

export class MetaService {
  constructor(
    private readonly accessToken: string,
    private readonly adAccountId: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  static fromSession(session: UserSession): MetaService {
    return new MetaService(session.meta_access_token, session.ad_account_id);
  }

  /**
   * Make a request to the Meta Graph API.
   *
   * @param endpoint - API path, e.g. `/act_123/campaigns`
   * @param options - Method, body, and query params
   * @throws {MetaApiError} When Meta returns an error object
   */
  async request<T = unknown>(endpoint: string, options: MetaRequestOptions = {}): Promise<T> {
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
      throw new MetaApiError(data.error as MetaApiError['metaError']);
    }

    return data as T;
  }

  /**
   * List all campaigns for the ad account.
   *
   * @returns Paginated list of campaigns with status, budget, and dates
   */
  async getCampaigns(): Promise<{ data: MetaCampaign[] }> {
    return this.request<{ data: MetaCampaign[] }>(`/act_${this.adAccountId}/campaigns`, {
      params: {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time',
        limit: '100',
      },
    });
  }

  /**
   * Get performance insights for a single campaign.
   *
   * @param campaignId - Meta campaign ID
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getCampaignInsights(
    campaignId: string,
    datePreset = 'today'
  ): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/${campaignId}/insights`, {
      params: { fields: INSIGHT_FIELDS, date_preset: datePreset },
    });
  }

  /**
   * Duplicate a campaign, creating a paused copy.
   *
   * @param campaignId - Source campaign ID
   * @param newName - Optional name override (defaults to `"<original> (Copy)"`)
   */
  async duplicateCampaign(campaignId: string, newName?: string): Promise<{ id: string }> {
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
   * Build a map of ad set ID → Meta action type used to count "Results".
   *
   * Meta's "Results" metric depends on the optimization goal of each ad set.
   * Different ad sets within the same campaign can have different goals (e.g.
   * one optimizes for `start_trial`, another for `complete_registration`), so
   * the map is keyed per ad set — not per campaign.
   *
   * @returns `{ [adsetId]: actionType }` e.g. `{ "456": "offsite_conversion.fb_pixel_start_trial" }`
   */
  async getOptimizationMap(): Promise<Record<string, string>> {
    const { adsetMap } = await this.fetchOptimizationMaps();

    return adsetMap;
  }

  /**
   * Build a map of campaign ID → Meta action type used to count "Results".
   *
   * Uses the first ad set per campaign to determine the optimization goal.
   * Suitable for campaign-level displays; for ad-level accuracy use
   * `getOptimizationMap()` which keys by ad set ID.
   *
   * @returns `{ [campaignId]: actionType }` e.g. `{ "123": "offsite_conversion.fb_pixel_lead" }`
   */
  async getCampaignOptimizationMap(): Promise<Record<string, string>> {
    const { campaignMap } = await this.fetchOptimizationMaps();

    return campaignMap;
  }

  /**
   * Internal helper that fetches ad sets once and builds both the ad-set-keyed
   * and campaign-keyed optimization maps in a single pass.
   */
  private async fetchOptimizationMaps(): Promise<{
    adsetMap: Record<string, string>;
    campaignMap: Record<string, string>;
  }> {
    const adsetMap: Record<string, string> = {};
    const campaignMap: Record<string, string> = {};
    let after: string | undefined;

    // Paginate through all ad sets to handle accounts with >200 ad sets
    for (;;) {
      const params: Record<string, string> = {
        fields: 'id,campaign_id,optimization_goal,promoted_object',
        limit: '200',
        // Exclude archived ad sets — their optimization goal may differ from active
        // ad sets in the same campaign, which would poison the result-type lookup map.
        filtering: JSON.stringify([
          { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
        ]),
      };

      if (after) params.after = after;

      const data = (await this.request(`/act_${this.adAccountId}/adsets`, { params })) as {
        data?: Array<{
          id: string;
          campaign_id: string;
          optimization_goal?: string;
          promoted_object?: Record<string, string>;
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
      };

      for (const adset of data.data || []) {
        const goal = adset.optimization_goal as string;
        const promoted = adset.promoted_object;

        // Meta API v21+ uses OUTCOME_* names alongside legacy names
        const isOffsite =
          goal === 'OFFSITE_CONVERSIONS' || goal === 'OUTCOME_SALES' || goal === 'OUTCOME_LEADS';

        let actionType: string | undefined;

        if (isOffsite && (promoted?.custom_event_type || promoted?.custom_conversion_id)) {
          // Meta API v21 reports all offsite pixel conversion events as
          // `offsite_conversion.fb_pixel_custom` in the actions array — not under
          // the specific event name (e.g. fb_pixel_start_trial). This applies to both
          // standard pixel events (custom_event_type) and custom conversions
          // (custom_conversion_id).
          actionType = 'offsite_conversion.fb_pixel_custom';
        } else if (goal === 'LEAD_GENERATION' || goal === 'OUTCOME_LEADS') {
          actionType = 'onsite_conversion.lead_grouped';
        } else if (goal === 'CONVERSATIONS' || goal === 'OUTCOME_ENGAGEMENT') {
          actionType = 'onsite_conversion.messaging_conversation_started_7d';
        } else if (
          goal === 'LINK_CLICKS' ||
          goal === 'LANDING_PAGE_VIEWS' ||
          goal === 'OUTCOME_TRAFFIC'
        ) {
          actionType = goal === 'LANDING_PAGE_VIEWS' ? 'landing_page_view' : 'link_click';
        }

        if (actionType) {
          adsetMap[adset.id] = actionType;

          // Campaign map uses first ad set's goal (for campaign-level displays)
          if (!campaignMap[adset.campaign_id]) {
            campaignMap[adset.campaign_id] = actionType;
          }
        }
      }

      // Follow pagination cursor if more pages exist
      if (!data.paging?.next) break;
      after = data.paging.cursors?.after;
      if (!after) break;
    }

    return { adsetMap, campaignMap };
  }

  /**
   * List ad sets, optionally filtered by campaign.
   *
   * @param campaignId - When provided, only returns ad sets for this campaign
   */
  async getAdSets(campaignId?: string): Promise<{ data: MetaAdSet[] }> {
    const endpoint = campaignId ? `/${campaignId}/adsets` : `/act_${this.adAccountId}/adsets`;

    return this.request<{ data: MetaAdSet[] }>(endpoint, {
      params: {
        fields:
          'id,name,campaign_id,campaign{name},status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,created_time,updated_time',
        limit: '100',
      },
    });
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
  ): Promise<{ id: string }> {
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
  async getAds(adSetId?: string): Promise<{ data: MetaAd[] }> {
    const endpoint = adSetId ? `/${adSetId}/ads` : `/act_${this.adAccountId}/ads`;

    return this.request<{ data: MetaAd[] }>(endpoint, {
      params: {
        fields:
          'id,name,adset_id,campaign_id,status,creative{id,name,title,body,image_url,thumbnail_url,link_url,call_to_action_type},created_time,updated_time',
        limit: '100',
      },
    });
  }

  /**
   * Get performance insights for a single ad.
   *
   * @param adId - Meta ad ID
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getAdInsights(adId: string, datePreset = 'today'): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/${adId}/insights`, {
      params: { fields: INSIGHT_FIELDS, date_preset: datePreset },
    });
  }

  /**
   * Upload an image to the ad account's image library.
   *
   * @param imageFile - Image file to upload
   * @returns Image hash and metadata from Meta
   */
  async uploadAdImage(imageFile: File): Promise<MetaImageUploadResponse> {
    const formData = new FormData();

    formData.append('filename', imageFile);
    formData.append('access_token', this.accessToken);

    const response = await this.fetchFn(`${META_BASE_URL}/act_${this.adAccountId}/adimages`, {
      method: 'POST',
      body: formData,
    });

    return response.json() as Promise<MetaImageUploadResponse>;
  }

  /**
   * Upload a video to the ad account's video library.
   *
   * @param videoFile - Video file to upload
   * @returns Video ID and metadata from Meta
   */
  async uploadAdVideo(videoFile: File): Promise<MetaVideoUploadResponse> {
    const formData = new FormData();

    formData.append('source', videoFile);
    formData.append('title', videoFile.name?.replace(/\.[^.]+$/, '') ?? 'video');
    formData.append('access_token', this.accessToken);

    const response = await this.fetchFn(`${META_BASE_URL}/act_${this.adAccountId}/advideos`, {
      method: 'POST',
      body: formData,
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (data.error) {
      throw new MetaApiError(data.error as MetaApiError['metaError']);
    }

    return data as unknown as MetaVideoUploadResponse;
  }

  /**
   * Create an ad creative with image/video and copy.
   *
   * @param creative - Creative parameters including page ID, link, and call-to-action
   */
  async createAdCreative(creative: CreateAdCreativeParams): Promise<{ id: string }> {
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

    return this.request<{ id: string }>(`/act_${this.adAccountId}/adcreatives`, {
      method: 'POST',
      body: { name: creative.name, object_story_spec: objectStorySpec },
    });
  }

  /**
   * Create an ad from an existing creative.
   *
   * @param ad - Ad name, target ad set, creative ID, and optional status
   */
  async createAd(ad: CreateAdParams): Promise<{ id: string }> {
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
  async updateStatus(objectId: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    await this.request(`/${objectId}`, { method: 'POST', body: { status } });
  }

  /**
   * Update the daily budget for a campaign or ad set.
   *
   * Meta represents budgets in cents (integer, account currency subunit).
   * Passing `100_00` sets a $100.00 daily budget for USD accounts.
   *
   * @param objectId - Campaign or ad set ID
   * @param dailyBudgetCents - Daily budget in the account currency's smallest unit (e.g. cents for USD)
   */
  async updateBudget(objectId: string, dailyBudgetCents: number): Promise<void> {
    await this.request(`/${objectId}`, {
      method: 'POST',
      body: { daily_budget: dailyBudgetCents.toString() },
    });
  }

  /**
   * Fetch the current daily budget for a campaign or ad set.
   *
   * Returns the budget in the account currency's smallest unit (cents for USD),
   * or `null` if the entity uses a lifetime budget instead of a daily budget.
   *
   * @param entityId - Campaign or ad set ID
   * @returns Daily budget in cents, or null if the entity has a lifetime budget
   */
  async getBudget(entityId: string): Promise<number | null> {
    const data = await this.request<{ daily_budget?: string }>(`/${entityId}`, {
      params: { fields: 'daily_budget' },
    });

    if (!data.daily_budget) return null;
    const cents = parseInt(data.daily_budget, 10);

    if (Number.isNaN(cents)) return null;

    return cents;
  }

  /**
   * Execute a single automation action on a Meta object.
   *
   * Unified entry point for pause/resume/budget actions — used by both the
   * chat actions endpoint and the Slack interactions handler.
   *
   * @param type - Action type: `'pause'`, `'resume'`, or `'update_budget'`
   * @param objectId - Campaign, ad set, or ad ID
   * @param dailyBudgetCents - Required when `type` is `'update_budget'`; daily budget in cents
   * @throws When `type` is `'update_budget'` and `dailyBudgetCents` is not provided
   */
  async executeAction(
    type: 'pause' | 'resume' | 'update_budget',
    objectId: string,
    dailyBudgetCents?: number
  ): Promise<void> {
    switch (type) {
      case 'pause':
        await this.updateStatus(objectId, 'PAUSED');
        break;
      case 'resume':
        await this.updateStatus(objectId, 'ACTIVE');
        break;

      case 'update_budget': {
        if (dailyBudgetCents === undefined || dailyBudgetCents <= 0) {
          throw new Error('dailyBudgetCents must be a positive number for update_budget action');
        }

        await this.updateBudget(objectId, dailyBudgetCents);
        break;
      }
    }
  }

  /**
   * Fetch filtered insights for active entities at a given level.
   *
   * Returns only entities with an `ACTIVE` effective status — safe to use in the
   * automation engine to avoid false pauses from stale paused-entity data.
   *
   * @param level - Entity level: `'ad'`, `'adset'`, or `'campaign'`
   * @param options.datePreset - Date range preset (default: `'last_7d'`)
   * @param options.campaignId - When provided, scopes the query to a single campaign
   * @returns Array of insight rows for all active entities at the requested level
   */
  async getFilteredInsights(
    level: 'ad' | 'adset' | 'campaign',
    options: { datePreset?: string; campaignId?: string } = {}
  ): Promise<MetaInsightsRow[]> {
    const { datePreset = 'last_7d', campaignId } = options;

    const fieldsByLevel: Record<string, string> = {
      ad: INSIGHT_FIELDS_AD,
      adset: INSIGHT_FIELDS_ADSET,
      campaign: INSIGHT_FIELDS_CAMPAIGN,
    };

    const limitByLevel: Record<string, string> = {
      ad: '500',
      adset: '200',
      campaign: '100',
    };

    const endpoint =
      level === 'ad' && campaignId
        ? `/${campaignId}/insights`
        : `/act_${this.adAccountId}/insights`;

    const response = await this.request<{ data?: MetaInsightsRow[] }>(endpoint, {
      params: {
        fields: fieldsByLevel[level],
        date_preset: datePreset,
        level,
        limit: limitByLevel[level],
        filtering: ACTIVE_FILTER[level],
        // Do NOT specify action_attribution_windows — it causes Meta API v21 to omit
        // conversion-type actions (e.g. start_trial, purchase) from the response entirely,
        // returning only engagement actions. Without this parameter, Meta uses the ad set's
        // own attribution setting, which matches what Ads Manager displays.
      },
    });

    let rows = response.data || [];

    // For adset/campaign level, campaignId filter must be applied client-side
    if ((level === 'adset' || level === 'campaign') && campaignId) {
      rows = rows.filter((row) => row.campaign_id === campaignId);
    }

    return rows;
  }

  /**
   * Get account-level performance insights.
   *
   * @param datePreset - Date range preset (default: `'today'`)
   * @param timeIncrement - Optional time breakdown, e.g. `'1'` for daily
   */
  async getAccountInsights(
    datePreset = 'today',
    timeIncrement?: string
  ): Promise<{ data: MetaInsightsRow[] }> {
    const params: Record<string, string> = { fields: INSIGHT_FIELDS, date_preset: datePreset };

    if (timeIncrement) params.time_increment = timeIncrement;

    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
      params,
    });
  }

  /**
   * Get insights broken down by campaign (`level=campaign`).
   *
   * @param datePreset - Date range preset (default: `'today'`)
   */
  async getCampaignLevelInsights(datePreset = 'today'): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
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
  async getAdSetLevelInsights(datePreset = 'today'): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
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
  async getAdLevelInsights(datePreset = 'today'): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
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
  ): Promise<{ data: MetaInsightsRow[] }> {
    const detail = INSIGHT_DETAIL_FIELDS[level] ?? '';
    const fields = [detail, INSIGHT_FIELDS, 'frequency'].filter(Boolean).join(',');
    const params: Record<string, string> = {
      fields,
      date_preset: datePreset,
      time_increment: '1',
      limit: '500',
    };

    if (level !== 'account') params.level = level;

    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
      params,
    });
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
  ): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
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
  ): Promise<{ data: MetaInsightsRow[] }> {
    const detail = INSIGHT_DETAIL_FIELDS[level] ?? '';
    const fields = [detail, INSIGHT_FIELDS, 'frequency'].filter(Boolean).join(',');
    const params: Record<string, string> = {
      fields,
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    };

    if (level !== 'account') params.level = level;

    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
      params,
    });
  }

  /**
   * Get hourly insights using Meta's hourly stats breakdown.
   * Only works for `'today'` or `'yesterday'` date presets.
   *
   * @param datePreset - Date range preset (default: `'today'`)
   * @param level - Breakdown level (default: `'account'`)
   */
  async getHourlyInsights(
    datePreset = 'today',
    level = 'account'
  ): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
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
  ): Promise<{ data: MetaInsightsRow[] }> {
    return this.request<{ data: MetaInsightsRow[] }>(`/act_${this.adAccountId}/insights`, {
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
  async getAdAccount(): Promise<MetaAdAccountInfo> {
    return this.request(`/act_${this.adAccountId}`, {
      params: { fields: 'id,name,account_status,currency,timezone_name,amount_spent' },
    });
  }

  // ─── Static OAuth helpers ────────────────────────────────────────────────────
  // These methods do not require an access token and are used during the OAuth
  // flow before credentials are available.

  /**
   * Exchange a Facebook OAuth authorization code for a short-lived access token.
   *
   * @param appId - Meta app ID (`META_APP_ID`)
   * @param appSecret - Meta app secret (`META_APP_SECRET`)
   * @param code - Authorization code from the OAuth redirect
   * @param redirectUri - Must match the URI registered in the Facebook app
   * @returns `{ access_token }` on success, `{ error }` on failure
   */
  static async exchangeCodeForToken(
    appId: string,
    appSecret: string,
    code: string,
    redirectUri: string
  ): Promise<{ access_token?: string; error?: unknown }> {
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const response = await fetch(`${META_BASE_URL}/oauth/access_token?${params.toString()}`);

    return response.json() as Promise<{ access_token?: string; error?: unknown }>;
  }

  /**
   * Exchange a short-lived Facebook access token for a long-lived one (60 days).
   *
   * @param appId - Meta app ID
   * @param appSecret - Meta app secret
   * @param shortLivedToken - Short-lived access token to exchange
   * @returns `{ access_token }` on success
   */
  static async exchangeForLongLivedToken(
    appId: string,
    appSecret: string,
    shortLivedToken: string
  ): Promise<{ access_token?: string }> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    });
    const response = await fetch(`${META_BASE_URL}/oauth/access_token?${params.toString()}`);

    return response.json() as Promise<{ access_token?: string }>;
  }

  /**
   * Fetch the authenticated user's basic profile (id, name, email).
   *
   * @param accessToken - A valid Meta user access token
   * @returns User profile fields
   */
  static async getMe(
    accessToken: string
  ): Promise<{ id: string; name?: string; email?: string; error?: unknown }> {
    const params = new URLSearchParams({ fields: 'id,name,email', access_token: accessToken });
    const response = await fetch(`${META_BASE_URL}/me?${params.toString()}`);

    return response.json() as Promise<{
      id: string;
      name?: string;
      email?: string;
      error?: unknown;
    }>;
  }

  /**
   * Fetch ad accounts the authenticated user has access to.
   *
   * @param accessToken - A valid Meta user access token
   * @returns `{ data: [{ id, name, account_status }] }`
   */
  static async getMyAdAccounts(
    accessToken: string
  ): Promise<{ data?: Array<{ id: string; name: string; account_status: number }> }> {
    const params = new URLSearchParams({
      fields: 'id,name,account_status',
      access_token: accessToken,
    });
    const response = await fetch(`${META_BASE_URL}/me/adaccounts?${params.toString()}`);

    return response.json() as Promise<{
      data?: Array<{ id: string; name: string; account_status: number }>;
    }>;
  }
}
