'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch } from '@/lib/queries/api-fetch';

/** Ad row as returned by `/api/meta/ads?with_insights=true`. */
export interface AdRow {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  campaign_name?: string;
  status: string;
  creative?: {
    id?: string;
    name?: string;
    title?: string;
    body?: string;
    image_url?: string;
    thumbnail_url?: string;
    link_url?: string;
    call_to_action_type?: string;
  };
  insights: {
    spend?: string;
    impressions?: string;
    clicks?: string;
    ctr?: string;
    cpc?: string;
    cost_per_inline_link_click?: string;
    actions?: Array<{ action_type: string; value: string }>;
    cost_per_action_type?: Array<{ action_type: string; value: string }>;
  } | null;
}

/**
 * Fetch ads, optionally scoped to an ad set and with insights.
 *
 * @param params - Query parameters.
 * @param params.datePreset - Meta date preset for insights.
 * @param params.adSetId - Filter to a specific ad set.
 * @param params.withInsights - Whether to attach per-ad insights. Defaults to `true`.
 * @param params.enabled - Whether the query should run. Defaults to `true`.
 * @returns TanStack Query result with `data` as an array of ads.
 */
export function useAds(params: {
  datePreset?: string;
  adSetId?: string;
  withInsights?: boolean;
  enabled?: boolean;
}) {
  const { datePreset, adSetId, withInsights = true, enabled = true } = params;
  const searchParams = new URLSearchParams();

  if (datePreset) searchParams.set('date_preset', datePreset);
  if (adSetId) searchParams.set('adset_id', adSetId);
  if (withInsights) searchParams.set('with_insights', 'true');

  const qs = searchParams.toString();

  return useQuery({
    queryKey: queryKeys.meta.ads({ adSetId, datePreset }),
    enabled,
    queryFn: () => apiFetch<{ data: AdRow[] }>(`/api/meta/ads${qs ? `?${qs}` : ''}`),
    select: (res) => res.data,
  });
}
