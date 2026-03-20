/** Centralized query key factory — single source of truth for all TanStack Query keys. */
export const queryKeys = {
  meta: {
    campaigns: (datePreset: string) => ['meta', 'campaigns', datePreset] as const,
    campaignsBase: () => ['meta', 'campaigns'] as const,
    adSets: (params: { campaignId?: string; datePreset?: string }) =>
      ['meta', 'adSets', params] as const,
    adSetsBase: () => ['meta', 'adSets'] as const,
    ads: (params: { adSetId?: string; datePreset?: string }) => ['meta', 'ads', params] as const,
    adsBase: () => ['meta', 'ads'] as const,
    insights: (datePreset: string) => ['meta', 'insights', datePreset] as const,
    accounts: () => ['meta', 'accounts'] as const,
  },
  automations: {
    rules: () => ['automations', 'rules'] as const,
    history: () => ['automations', 'history'] as const,
    preview: (params: Record<string, unknown>) => ['automations', 'preview', params] as const,
  },
  slack: {
    status: () => ['slack', 'status'] as const,
  },
};
