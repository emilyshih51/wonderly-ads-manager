'use client';

import dynamic from 'next/dynamic';
import { useState, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
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

const SIZE = 160; // px — matches h-40 w-40

/**
 * Fixed-position overlay with the 3D robot assistant and chat panel.
 * Hover → wiggle, click → bounce + open panel. Drag to reposition (persisted).
 */
export function AssistantOverlay() {
  const { assistantEnabled, assistantPanelOpen, toggleAssistantPanel, position, setPosition } =
    useAssistantStore();
  const pathname = usePathname();
  const [hovered, setHovered] = useState(false);
  const [animState, setAnimState] = useState<AnimationState>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state — kept in refs to avoid re-renders during drag
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const dragStart = useRef({ px: 0, py: 0, right: 0, bottom: 0 });

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
    // Suppress click if the pointer was dragged
    if (dragMoved.current) return;
    toggleAssistantPanel();
    setAnimState('celebrate');
    scheduleIdle(600);
  }, [toggleAssistantPanel, scheduleIdle]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only drag with primary button
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      dragMoved.current = false;
      dragStart.current = {
        px: e.clientX,
        py: e.clientY,
        right: position.right,
        bottom: position.bottom,
      };
    },
    [position]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;

      const dx = e.clientX - dragStart.current.px;
      const dy = e.clientY - dragStart.current.py;

      // Only start treating as drag after 4px movement
      if (!dragMoved.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      if (!dragMoved.current) setIsDragging(true);
      dragMoved.current = true;

      const newRight = Math.max(
        0,
        Math.min(window.innerWidth - SIZE, dragStart.current.right - dx)
      );
      const newBottom = Math.max(
        0,
        Math.min(window.innerHeight - SIZE, dragStart.current.bottom - dy)
      );

      setPosition({ right: newRight, bottom: newBottom });
    },
    [setPosition]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    setIsDragging(false);
  }, []);

  const hiddenRoutes = ['/chat'];

  if (!assistantEnabled || hiddenRoutes.includes(pathname)) return null;

  return (
    <>
      <div
        className="fixed z-10000 h-40 w-40"
        style={{ right: position.right, bottom: position.bottom }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label="Open assistant chat"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onKeyDown={(e) => e.key === 'Enter' && handleClick()}
          className={cn(
            'relative h-full w-full rounded-full transition-transform duration-200 select-none hover:scale-110 active:scale-95',
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
            'filter-[drop-shadow(0_0_12px_rgba(96,165,250,0.5))_drop-shadow(0_0_30px_rgba(96,165,250,0.25))]'
          )}
        >
          <AssistantTooltip visible={hovered && !assistantPanelOpen && !isDragging} />
          <AssistantCharacter animationState={animState} />
        </div>
      </div>
      <AssistantPanel />
    </>
  );
}
