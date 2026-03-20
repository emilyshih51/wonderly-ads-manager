'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch, apiPost, apiPut, apiDelete } from '@/lib/queries/api-fetch';
import type { AutomationRule } from '@/types';

interface RulesResponse {
  data: AutomationRule[];
  kv_configured: boolean;
}

/**
 * Fetch all automation rules for the current user.
 *
 * @returns TanStack Query result with `data` as an array of rules.
 */
export function useRules() {
  return useQuery({
    queryKey: queryKeys.automations.rules(),
    queryFn: () => apiFetch<RulesResponse>('/api/automations/rules'),
    select: (res) => res.data,
  });
}

/**
 * Mutation for creating or updating an automation rule.
 * Invalidates the rules list on success.
 *
 * @returns TanStack mutation that accepts a rule payload.
 */
export function useSaveRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      id?: string;
      name: string;
      is_active: boolean;
      nodes: unknown[];
      edges: unknown[];
    }) => {
      if (payload.id) {
        return apiPut<AutomationRule>('/api/automations/rules', payload);
      }

      return apiPost<AutomationRule>('/api/automations/rules', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations.rules() });
    },
  });
}

/**
 * Mutation for deleting an automation rule by ID.
 * Invalidates the rules list on success.
 *
 * @returns TanStack mutation that accepts a rule ID.
 */
export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId: string) => apiDelete(`/api/automations/rules?id=${ruleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations.rules() });
    },
  });
}

/**
 * Mutation for toggling a rule's active state.
 * Invalidates the rules list on success.
 *
 * @returns TanStack mutation that accepts `{ id, is_active }`.
 */
export function useToggleRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { id: string; is_active: boolean }) =>
      apiPut('/api/automations/rules', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations.rules() });
    },
  });
}
