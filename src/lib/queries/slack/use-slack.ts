'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { apiFetch } from '@/lib/queries/api-fetch';

interface SlackStatusResponse {
  configured: boolean;
  bot_token: boolean;
  signing_secret: boolean;
}

/**
 * Fetch Slack bot configuration status.
 * Uses a longer stale time since Slack config rarely changes.
 *
 * @returns TanStack Query result with `data` as the Slack status object.
 */
export function useSlackStatus() {
  return useQuery({
    queryKey: queryKeys.slack.status(),
    staleTime: 5 * 60_000, // 5 min — Slack config rarely changes
    queryFn: () => apiFetch<SlackStatusResponse>('/api/slack/status'),
  });
}
