import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Global state for the floating assistant character and chat panel. */
interface AssistantState {
  /** Whether the assistant character overlay is visible. Persisted to localStorage. */
  assistantEnabled: boolean;
  /** Whether the assistant chat panel is currently open. */
  assistantPanelOpen: boolean;
  /** Persisted position as distance from the right and bottom edges in px. */
  position: { right: number; bottom: number };
  /** Show or hide the assistant character. */
  setAssistantEnabled: (enabled: boolean) => void;
  /** Toggle the chat panel open/closed. */
  toggleAssistantPanel: () => void;
  /** Close the chat panel. */
  closeAssistantPanel: () => void;
  /** Update the persisted position. */
  setPosition: (position: { right: number; bottom: number }) => void;
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set) => ({
      assistantEnabled: true,
      assistantPanelOpen: false,
      position: { right: 12, bottom: 24 },
      setAssistantEnabled: (enabled) => set({ assistantEnabled: enabled }),
      toggleAssistantPanel: () => set((s) => ({ assistantPanelOpen: !s.assistantPanelOpen })),
      closeAssistantPanel: () => set({ assistantPanelOpen: false }),
      setPosition: (position) => set({ position }),
    }),
    {
      name: 'wonderly-assistant',
      // Persist enabled toggle and position; panel open state resets on refresh
      partialize: (state) => ({
        assistantEnabled: state.assistantEnabled,
        position: state.position,
      }),
    }
  )
);
