import { create } from 'zustand';

/** Global client-side state shared across all dashboard pages. */
interface AppState {
  /** Currently selected date preset for all Meta API insight queries (e.g. `today`, `last_7d`). */
  datePreset: string;
  /** Whether a full-page loading indicator should be shown. */
  isLoading: boolean;
  /** Active Meta ad account ID in `act_<number>` format. */
  adAccountId: string;
  /** Update the active date preset. */
  setDatePreset: (preset: string) => void;
  /** Toggle the full-page loading indicator. */
  setIsLoading: (loading: boolean) => void;
  /** Switch the active ad account. */
  setAdAccountId: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  datePreset: 'today',
  isLoading: false,
  adAccountId: '',
  setDatePreset: (preset) => set({ datePreset: preset }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setAdAccountId: (id) => set({ adAccountId: id }),
}));
