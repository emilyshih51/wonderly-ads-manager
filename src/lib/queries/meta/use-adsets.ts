'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch } from '@/lib/queries/api-fetch';

/** Insights fields returned by `/api/meta/adsets?with_insights=true`. */
export interface AdSetInsights {
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  cpm?: string;
  ctr?: string;
  cpc?: string;
  cost_per_inline_link_click?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}

/** Ad set row as returned by `/api/meta/adsets?with_insights=true`. */
export interface AdSetRow {
  id: string;
  name: string;
  campaign_id: string;
  campaign?: { name: string };
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  insights: AdSetInsights | null;
}

/**
 * Fetch ad sets, optionally scoped to a campaign and with insights.
 *
 * @param params - Query parameters.
 * @param params.campaignId - Filter to a specific campaign.
 * @param params.datePreset - Meta date preset for insights.
 * @param params.withInsights - Whether to attach per-adset insights. Defaults to `false`.
 * @param params.enabled - Whether the query should run. Defaults to `true`.
 * @returns TanStack Query result with `data` as an array of ad sets.
 */
export function useAdSets(params: {
  campaignId?: string;
  datePreset?: string;
  withInsights?: boolean;
  enabled?: boolean;
}) {
  const { campaignId, datePreset, withInsights = false, enabled = true } = params;
  const searchParams = new URLSearchParams();

  if (campaignId) searchParams.set('campaign_id', campaignId);
  if (datePreset) searchParams.set('date_preset', datePreset);
  if (withInsights) searchParams.set('with_insights', 'true');

  const qs = searchParams.toString();

  return useQuery({
    queryKey: queryKeys.meta.adSets({ campaignId, datePreset }),
    enabled,
    queryFn: () => apiFetch<{ data: AdSetRow[] }>(`/api/meta/adsets${qs ? `?${qs}` : ''}`),
    select: (res) => res.data,
  });
}
