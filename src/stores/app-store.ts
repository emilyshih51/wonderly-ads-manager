import { create } from 'zustand';

/** Global client-side state shared across all dashboard pages. */
interface AppState {
  /** Currently selected date preset for all Meta API insight queries (e.g. `today`, `last_7d`). */
  datePreset: string;
  /** Whether a full-page loading indicator should be shown. */
  isLoading: boolean;
  /** Active Meta ad account ID in `act_<number>` format. */
  adAccountId: string;
  /** Filter ads page to a specific campaign ID (set from campaigns table "View Ads"). */
  filterCampaignId: string | null;
  /** Filter ads page to a specific ad set ID (set from ad sets table "View Ads"). */
  filterAdSetId: string | null;
  /** Update the active date preset. */
  setDatePreset: (preset: string) => void;
  /** Toggle the full-page loading indicator. */
  setIsLoading: (loading: boolean) => void;
  /** Switch the active ad account. */
  setAdAccountId: (id: string) => void;
  /** Set campaign filter for the ads page. */
  setFilterCampaignId: (id: string | null) => void;
  /** Set ad set filter for the ads page. */
  setFilterAdSetId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  datePreset: 'today',
  isLoading: false,
  adAccountId: '',
  filterCampaignId: null,
  filterAdSetId: null,
  setDatePreset: (preset) => set({ datePreset: preset }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setAdAccountId: (id) => set({ adAccountId: id }),
  setFilterCampaignId: (id) => set({ filterCampaignId: id }),
  setFilterAdSetId: (id) => set({ filterAdSetId: id }),
}));
