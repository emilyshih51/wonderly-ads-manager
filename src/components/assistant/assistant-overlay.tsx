'use client';

import dynamic from 'next/dynamic';
import { useState, useRef, useCallback } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import { AssistantTooltip } from './assistant-tooltip';
import { AssistantPanel } from './assistant-panel';
import type { AnimationState } from './assistant-character';
import { cn } from '@/lib/utils';

// Lazy-load Three.js — never runs on server
const AssistantCharacter = dynamic(
  () => import('./assistant-character').then((m) => ({ default: m.AssistantCharacter })),
  { ssr: false }
);

/**
 * Fixed-position overlay with the 3D Shiba and chat panel.
 * Hover → wiggle, click → bounce + open panel.
 */
export function AssistantOverlay() {
  const { assistantEnabled, assistantPanelOpen, toggleAssistantPanel } = useAssistantStore();
  const [hovered, setHovered] = useState(false);
  const [animState, setAnimState] = useState<AnimationState>('idle');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleIdle = useCallback((delay: number) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAnimState('idle'), delay);
  }, []);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);

    if (animState === 'idle') {
      setAnimState('wave');
      scheduleIdle(1000);
    }
  }, [animState, scheduleIdle]);

  const handleMouseLeave = useCallback(() => setHovered(false), []);

  const handleClick = useCallback(() => {
    toggleAssistantPanel();
    setAnimState('celebrate');
    scheduleIdle(600);
  }, [toggleAssistantPanel, scheduleIdle]);

  if (!assistantEnabled) return null;

  return (
    <>
      <div className="fixed right-6 bottom-6 z-[10000] h-[110px] w-[110px]">
        <div
          role="button"
          tabIndex={0}
          aria-label="Open assistant chat"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onKeyDown={(e) => e.key === 'Enter' && handleClick()}
          className={cn(
            'relative h-full w-full cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95'
          )}
        >
          <AssistantTooltip visible={hovered && !assistantPanelOpen} />
          <AssistantCharacter animationState={animState} />
        </div>
      </div>
      <AssistantPanel />
    </>
  );
}
