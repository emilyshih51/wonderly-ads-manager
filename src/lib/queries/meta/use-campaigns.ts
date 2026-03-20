'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch } from '@/lib/queries/api-fetch';

/** Insights fields returned by `/api/meta/campaigns?with_insights=true`. */
export interface CampaignInsights {
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  cpm?: string;
  ctr?: string;
  cpc?: string;
  cost_per_inline_link_click?: string;
  reach?: string;
  date_start?: string;
  date_stop?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}

/** Campaign row as returned by `/api/meta/campaigns?with_insights=true`. */
export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time?: string;
  updated_time?: string;
  insights: CampaignInsights | null;
  result_action_type?: string | null;
}

interface CampaignsResponse {
  data: CampaignRow[];
  optimizationMap?: Record<string, string>;
}

/**
 * Fetch campaigns with optional insights attached.
 *
 * @param datePreset - Meta date preset (e.g. `'today'`, `'last_7d'`).
 * @param options - Additional query options.
 * @param options.withInsights - Whether to include per-campaign insights. Defaults to `true`.
 * @returns TanStack Query result with `data` as an array of campaigns.
 */
export function useCampaigns(datePreset: string, options: { withInsights?: boolean } = {}) {
  const { withInsights = true } = options;
  const params = new URLSearchParams({ date_preset: datePreset });

  if (withInsights) params.set('with_insights', 'true');

  return useQuery({
    queryKey: queryKeys.meta.campaigns(datePreset),
    queryFn: () => apiFetch<CampaignsResponse>(`/api/meta/campaigns?${params}`),
    select: (res) => res.data,
  });
}

/**
 * Fetch campaigns without insights (for dropdowns/pickers).
 *
 * @returns TanStack Query result with `data` as an array of campaigns.
 */
export function useCampaignList() {
  return useQuery({
    queryKey: queryKeys.meta.campaigns('none'),
    queryFn: () => apiFetch<{ data: CampaignRow[] }>('/api/meta/campaigns'),
    select: (res) => res.data,
  });
}
