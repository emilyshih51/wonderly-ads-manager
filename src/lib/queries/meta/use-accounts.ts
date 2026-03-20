'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch } from '@/lib/queries/api-fetch';

interface AdAccount {
  id: string;
  name: string;
  account_status: number;
}

/**
 * Fetch ad accounts for the current user.
 *
 * @returns TanStack Query result with `data` as an array of ad accounts.
 */
export function useAdAccounts() {
  return useQuery({
    queryKey: queryKeys.meta.accounts(),
    staleTime: 5 * 60_000, // accounts change rarely
    queryFn: () => apiFetch<{ accounts: AdAccount[] }>('/api/meta/accounts'),
    select: (res) => res.accounts,
  });
}
