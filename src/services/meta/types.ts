/** Options for a raw Meta Graph API request. */
export interface MetaRequestOptions {
  /** HTTP method — defaults to `GET`. */
  method?: 'GET' | 'POST';
  /** Request body for POST requests. Use `FormData` for image uploads. */
  body?: Record<string, unknown> | FormData;
  /** URL query parameters appended to the request. */
  params?: Record<string, string>;
}

/** Error thrown when the Meta Graph API returns an error response. */
export interface MetaApiError extends Error {
  /** Structured error detail from the Meta API response body. */
  metaError: {
    /** Human-readable error description. */
    message: string;
    /** Error category (e.g. `OAuthException`, `GraphMethodException`). */
    type?: string;
    /** Meta error code. */
    code?: number;
    /** Meta error sub-code for more specific error classification. */
    error_subcode?: number;
    /** Short title shown to the end user by Meta's own UI. */
    error_user_title?: string;
    /** Detailed message shown to the end user by Meta's own UI. */
    error_user_msg?: string;
  };
}

/** Granularity level for insight queries. */
export type InsightLevel = 'account' | 'campaign' | 'adset' | 'ad';

/** Parameters required to create a new ad creative. */
export interface CreateAdCreativeParams {
  /** Display name for the creative. */
  name: string;
  /** Facebook Page ID used as the ad identity. */
  pageId: string;
  /** Hash of a previously uploaded image asset (mutually exclusive with `videoId`). */
  imageHash?: string;
  /** ID of a previously uploaded video asset (mutually exclusive with `imageHash`). */
  videoId?: string;
  /** Primary ad copy (body text shown below the headline). */
  message: string;
  /** Destination URL the ad links to. */
  link: string;
  /** Ad headline shown in the link preview. */
  headline: string;
  /** Optional description shown below the headline. */
  description?: string;
  /** Call-to-action button type (e.g. `LEARN_MORE`, `SIGN_UP`). */
  callToAction: string;
}

/** Parameters required to create a new ad. */
export interface CreateAdParams {
  /** Display name for the ad. */
  name: string;
  /** ID of the ad set this ad belongs to. */
  adsetId: string;
  /** ID of the creative to attach to this ad. */
  creativeId: string;
  /** Initial delivery status — defaults to `PAUSED` if omitted. */
  status?: string;
}

/** Contract for the Meta service. */
export interface IMetaService {
  /** Fetch all campaigns for the active ad account. */
  getCampaigns(): Promise<{ data: import('@/types').MetaCampaign[] }>;
  /** Fetch aggregated insights for a single campaign. */
  getCampaignInsights(campaignId: string, datePreset?: string): Promise<unknown>;
  /** Duplicate a campaign, optionally renaming the copy. */
  duplicateCampaign(campaignId: string, newName?: string): Promise<unknown>;
  /** Return a map of campaign ID → optimization goal for all active campaigns. */
  getCampaignOptimizationMap(): Promise<Record<string, string>>;
  /** Fetch ad sets, optionally filtered by campaign. */
  getAdSets(campaignId?: string): Promise<{ data: import('@/types').MetaAdSet[] }>;
  /** Duplicate an ad set, optionally renaming it and moving it to a different campaign. */
  duplicateAdSet(adSetId: string, newName?: string, targetCampaignId?: string): Promise<unknown>;
  /** Fetch ads, optionally filtered by ad set. */
  getAds(adSetId?: string): Promise<{ data: import('@/types').MetaAd[] }>;
  /** Fetch aggregated insights for a single ad. */
  getAdInsights(adId: string, datePreset?: string): Promise<unknown>;
  /** Upload an image file and return the image hash for use in creatives. */
  uploadAdImage(imageFile: File): Promise<unknown>;
  /** Create a new ad creative from the given parameters. */
  createAdCreative(creative: CreateAdCreativeParams): Promise<unknown>;
  /** Create a new ad and attach it to an ad set. */
  createAd(ad: CreateAdParams): Promise<unknown>;
  /** Duplicate an ad into a target ad set, optionally renaming the copy. */
  duplicateAd(adId: string, targetAdSetId: string, newName?: string): Promise<{ id: string }>;
  /** Update the delivery status of any campaign, ad set, or ad. */
  updateStatus(objectId: string, status: 'ACTIVE' | 'PAUSED'): Promise<void>;
  /** Update the daily budget for a campaign or ad set (amount in account currency cents). */
  updateBudget(objectId: string, dailyBudgetCents: number): Promise<void>;
  /** Unified action executor for pause/resume/budget changes. */
  executeAction(
    type: 'pause' | 'resume' | 'update_budget',
    objectId: string,
    dailyBudgetCents?: number
  ): Promise<void>;
  /** Fetch account-level insights aggregated across all campaigns. */
  getAccountInsights(datePreset?: string, timeIncrement?: string): Promise<unknown>;
  /** Fetch insights broken down by campaign. */
  getCampaignLevelInsights(datePreset?: string): Promise<unknown>;
  /** Fetch insights broken down by ad set. */
  getAdSetLevelInsights(datePreset?: string): Promise<unknown>;
  /** Fetch insights broken down by individual ad. */
  getAdLevelInsights(datePreset?: string): Promise<unknown>;
  /** Fetch day-by-day insights at the specified level. */
  getDailyInsights(datePreset?: string, level?: InsightLevel): Promise<unknown>;
  /** Fetch insights with audience or placement breakdowns. */
  getInsightsWithBreakdowns(datePreset?: string, breakdowns?: string): Promise<unknown>;
  /** Fetch insights for an explicit date range (YYYY-MM-DD). */
  getInsightsForDateRange(since: string, until: string, level?: InsightLevel): Promise<unknown>;
  /** Fetch insights broken down by hour of day. */
  getHourlyInsights(datePreset?: string, level?: string): Promise<unknown>;
  /** Fetch hourly insights for a specific date range. */
  getHourlyInsightsForDate(dateStart: string, dateEnd: string, level?: string): Promise<unknown>;
  /** Fetch the ad account object (spend limits, currency, timezone, etc.). */
  getAdAccount(): Promise<unknown>;
  /** Fetch insights for active entities at a given level, optionally scoped to a campaign. */
  getFilteredInsights(
    level: 'ad' | 'adset' | 'campaign',
    options?: { datePreset?: string; campaignId?: string }
  ): Promise<import('@/types').MetaInsightsRow[]>;
}
