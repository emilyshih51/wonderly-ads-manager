import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Global state for the floating assistant character and chat panel. */
interface AssistantState {
  /** Whether the assistant character overlay is visible. Persisted to localStorage. */
  assistantEnabled: boolean;
  /** Whether the assistant chat panel is currently open. */
  assistantPanelOpen: boolean;
  /** Show or hide the assistant character. */
  setAssistantEnabled: (enabled: boolean) => void;
  /** Toggle the chat panel open/closed. */
  toggleAssistantPanel: () => void;
  /** Close the chat panel. */
  closeAssistantPanel: () => void;
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set) => ({
      assistantEnabled: true,
      assistantPanelOpen: false,
      setAssistantEnabled: (enabled) => set({ assistantEnabled: enabled }),
      toggleAssistantPanel: () => set((s) => ({ assistantPanelOpen: !s.assistantPanelOpen })),
      closeAssistantPanel: () => set({ assistantPanelOpen: false }),
    }),
    {
      name: 'wonderly-assistant',
      // Only persist the enabled toggle — panel open state resets on refresh
      partialize: (state) => ({ assistantEnabled: state.assistantEnabled }),
    }
  )
);
