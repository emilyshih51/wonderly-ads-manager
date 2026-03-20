'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch, apiPost } from '@/lib/queries/api-fetch';
import { getPriorPeriodDates } from '@/lib/theme';
import type { MetaInsightsRow } from '@/types';
import type { CampaignRow } from './use-campaigns';
import type { AdSetRow } from './use-adsets';
import type { AdRow } from './use-ads';

/**
 * Fetch account-level time-series insights for dashboard charts.
 *
 * @param datePreset - Meta date preset (e.g. `'today'`, `'last_7d'`).
 * @returns TanStack Query result with `data` as an array of daily insight rows.
 */
export function useDashboardInsights(datePreset: string) {
  return useQuery({
    queryKey: queryKeys.meta.insights(datePreset),
    queryFn: () =>
      apiFetch<{ data: MetaInsightsRow[] }>(
        `/api/meta/insights?date_preset=${datePreset}&time_increment=1`
      ),
    select: (res) => res.data,
  });
}

/**
 * Fetch campaigns for the prior period matching the given date preset.
 * Used for trend arrows and percentage-change indicators on metric cards.
 * Returns null data when a prior period is not applicable (e.g. 'today').
 *
 * @param datePreset - Current date preset (e.g. 'last_7d')
 * @returns TanStack Query result with prior-period campaign rows.
 */
export function useCampaignsPriorPeriod(datePreset: string) {
  const priorRange = getPriorPeriodDates(datePreset);

  return useQuery({
    queryKey: ['campaigns', 'prior', datePreset],
    enabled: !!priorRange,
    queryFn: () => {
      const { since, until } = priorRange!;

      return apiFetch<{ data: CampaignRow[] }>(
        `/api/meta/campaigns?since=${since}&until=${until}&with_insights=true`
      );
    },
    select: (res) => res.data,
    staleTime: 10 * 60_000, // prior data doesn't change
  });
}

/**
 * Fetch drill-down data (ad sets + ads) for a specific campaign.
 * Disabled when `campaignId` is `'all'` or empty.
 *
 * @param campaignId - The campaign to drill into, or `'all'` to disable.
 * @param datePreset - Meta date preset for insights.
 * @returns TanStack Query result with ad sets and ads for the selected campaign.
 */
export function useDrillDown(campaignId: string, datePreset: string) {
  const enabled = !!campaignId && campaignId !== 'all';

  const adSetsQuery = useQuery({
    queryKey: [...queryKeys.meta.adSets({ campaignId, datePreset }), 'drill'] as const,
    enabled,
    queryFn: () =>
      apiFetch<{ data: AdSetRow[] }>(
        `/api/meta/adsets?campaign_id=${campaignId}&with_insights=true&date_preset=${datePreset}`
      ),
    select: (res) => res.data,
  });

  const adSetIds = adSetsQuery.data?.map((a) => a.id) ?? [];

  const adsQuery = useQuery({
    queryKey: [...queryKeys.meta.ads({ datePreset }), 'drill', campaignId] as const,
    enabled: enabled && adSetIds.length > 0,
    queryFn: async () => {
      const promises = adSetIds.map((id) =>
        apiFetch<{ data: AdRow[] }>(
          `/api/meta/ads?adset_id=${id}&with_insights=true&date_preset=${datePreset}`
        ).then((r) => r.data)
      );

      return (await Promise.all(promises)).flat();
    },
  });

  return {
    adSets: adSetsQuery.data ?? [],
    ads: adsQuery.data ?? [],
    isLoading: adSetsQuery.isLoading || (adSetIds.length > 0 && adsQuery.isLoading),
    isFetching: adSetsQuery.isFetching || adsQuery.isFetching,
  };
}

/**
 * Mutation for updating an ad set or campaign budget.
 * Invalidates campaign and ad set queries on success.
 *
 * @returns TanStack mutation for budget updates.
 */
export function useBudgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      adset_id?: string;
      campaign_id?: string;
      entity_id?: string;
      adset_name?: string;
      campaign_name?: string;
      entity_name?: string;
      daily_budget: string | number;
      previous_budget?: string | number;
    }) => apiPost('/api/meta/adsets/update', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meta.campaignsBase() });
      queryClient.invalidateQueries({ queryKey: queryKeys.meta.adSetsBase() });
    },
  });
}
