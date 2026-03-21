'use client';

import { cn } from '@/lib/utils';

interface AssistantTooltipProps {
  /** Whether the tooltip bubble is visible. */
  visible: boolean;
}

/**
 * Hover bubble displayed above the assistant character when the panel is closed.
 *
 * @param visible - Controls opacity/pointer-events. Use CSS transitions for show/hide.
 */
export function AssistantTooltip({ visible }: AssistantTooltipProps) {
  return (
    <div
      className={cn(
        'absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg',
        'border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5',
        'text-xs font-medium text-[var(--color-foreground)] shadow-md',
        'pointer-events-none transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      Hi! Ask me anything ✨
    </div>
  );
}
