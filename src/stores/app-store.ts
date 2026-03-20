import { create } from 'zustand';

interface AppState {
  datePreset: string;
  isLoading: boolean;
  adAccountId: string;
  setDatePreset: (preset: string) => void;
  setIsLoading: (loading: boolean) => void;
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
