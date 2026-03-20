'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch, apiPost } from '@/lib/queries/api-fetch';

interface HistoryEvent {
  id: string;
  rule_name: string;
  type: string;
  matched: number;
  results: Array<{
    entity_id?: string;
    entity_name?: string;
    action?: string;
    metrics?: { spend?: number; results?: number; cost_per_result?: number | string };
    slack_sent?: boolean;
    slack_channel?: string;
    error?: string;
  }>;
  timestamp: number;
}

/**
 * Fetch automation run history for the current user.
 *
 * @returns TanStack Query result with `data` as an array of history events.
 */
export function useAutomationHistory() {
  return useQuery({
    queryKey: queryKeys.automations.history(),
    queryFn: () => apiFetch<{ data: HistoryEvent[] }>('/api/automations/history'),
    select: (res) => res.data,
  });
}

/**
 * Mutation for logging a new automation run event.
 * Invalidates the history list on success.
 *
 * @returns TanStack mutation that accepts history event payload.
 */
export function useLogHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      rule_name: string;
      type: string;
      matched: number;
      results: HistoryEvent['results'];
    }) => apiPost('/api/automations/history', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations.history() });
    },
  });
}
