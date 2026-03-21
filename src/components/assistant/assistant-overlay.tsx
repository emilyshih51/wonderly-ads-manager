'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import { AssistantTooltip } from './assistant-tooltip';
import { AssistantPanel } from './assistant-panel';
import type { AnimationState } from './assistant-character';

// Lazy-load Three.js — never runs on server
const AssistantCharacter = dynamic(
  () => import('./assistant-character').then((m) => ({ default: m.AssistantCharacter })),
  { ssr: false }
);

/**
 * Fixed-position overlay that renders the 3D assistant character and chat panel.
 * Reads `assistantEnabled` from the store and renders nothing when disabled.
 */
export function AssistantOverlay() {
  const { assistantEnabled, assistantPanelOpen, toggleAssistantPanel } = useAssistantStore();
  const [hovered, setHovered] = useState(false);
  const [animState] = useState<AnimationState>('idle');

  if (!assistantEnabled) return null;

  return (
    <>
      {/* Character button */}
      <div className="fixed right-6 bottom-6 z-[10000]" style={{ width: 110, height: 110 }}>
        <div
          className="relative h-full w-full cursor-pointer"
          onClick={toggleAssistantPanel}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          role="button"
          tabIndex={0}
          aria-label="Open assistant chat"
          onKeyDown={(e) => e.key === 'Enter' && toggleAssistantPanel()}
        >
          <AssistantTooltip visible={hovered && !assistantPanelOpen} />
          <AssistantCharacter animationState={animState} />
        </div>
      </div>

      {/* Chat panel */}
      <AssistantPanel />
    </>
  );
}
