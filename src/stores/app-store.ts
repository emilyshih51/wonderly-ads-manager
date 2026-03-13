import { create } from 'zustand';

interface AppState {
  datePreset: string;
  setDatePreset: (preset: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  adAccountId: string;
  setAdAccountId: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  datePreset: 'today',
  setDatePreset: (preset) => set({ datePreset: preset }),
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  adAccountId: '',
  setAdAccountId: (id) => set({ adAccountId: id }),
}));
