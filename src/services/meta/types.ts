export interface MetaRequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown> | FormData;
  params?: Record<string, string>;
}

export interface MetaApiError extends Error {
  metaError: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
}

export type InsightLevel = 'account' | 'campaign' | 'adset' | 'ad';

export interface CreateAdCreativeParams {
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

export interface CreateAdParams {
  name: string;
  adsetId: string;
  creativeId: string;
  status?: string;
}

export interface IMetaService {
  getCampaigns(): Promise<{ data: unknown[] }>;
  getCampaignInsights(campaignId: string, datePreset?: string): Promise<unknown>;
  duplicateCampaign(campaignId: string, newName?: string): Promise<unknown>;
  getCampaignOptimizationMap(): Promise<Record<string, string>>;
  getAdSets(campaignId?: string): Promise<{ data: unknown[] }>;
  duplicateAdSet(adSetId: string, newName?: string, targetCampaignId?: string): Promise<unknown>;
  getAds(adSetId?: string): Promise<{ data: unknown[] }>;
  getAdInsights(adId: string, datePreset?: string): Promise<unknown>;
  uploadAdImage(imageFile: File): Promise<unknown>;
  createAdCreative(creative: CreateAdCreativeParams): Promise<unknown>;
  createAd(ad: CreateAdParams): Promise<unknown>;
  duplicateAd(adId: string, targetAdSetId: string, newName?: string): Promise<{ id: string }>;
  updateStatus(objectId: string, status: 'ACTIVE' | 'PAUSED'): Promise<unknown>;
  getAccountInsights(datePreset?: string, timeIncrement?: string): Promise<unknown>;
  getCampaignLevelInsights(datePreset?: string): Promise<unknown>;
  getAdSetLevelInsights(datePreset?: string): Promise<unknown>;
  getAdLevelInsights(datePreset?: string): Promise<unknown>;
  getDailyInsights(datePreset?: string, level?: InsightLevel): Promise<unknown>;
  getInsightsWithBreakdowns(datePreset?: string, breakdowns?: string): Promise<unknown>;
  getInsightsForDateRange(since: string, until: string, level?: InsightLevel): Promise<unknown>;
  getHourlyInsights(datePreset?: string, level?: string): Promise<unknown>;
  getHourlyInsightsForDate(dateStart: string, dateEnd: string, level?: string): Promise<unknown>;
  getAdAccount(): Promise<unknown>;
}
