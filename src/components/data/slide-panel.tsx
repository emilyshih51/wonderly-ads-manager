'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
}

/**
 * Right-side slide-over panel built on Radix Dialog.
 * Used for stat detail views and ad previews.
 *
 * @param open - Whether the panel is open
 * @param onOpenChange - Called when open state should change
 * @param title - Panel header title
 * @param description - Optional subtitle
 * @param children - Panel body content
 * @param width - Panel width (default '480px')
 */
export function SlidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = '480px',
}: SlidePanelProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-[overlay-hide_200ms_ease-in] data-[state=open]:animate-[overlay-show_300ms_ease-out]" />

        {/* Panel — full-width on mobile, fixed width on sm+ */}
        <DialogPrimitive.Content
          className={cn(
            'slide-panel fixed top-0 right-0 z-50 flex h-full w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-card)] shadow-xl sm:max-w-[var(--slide-panel-w)]',
            'data-[state=open]:animate-[slide-in_300ms_cubic-bezier(0.16,1,0.3,1)]',
            'data-[state=closed]:animate-[slide-out_200ms_ease-in]'
          )}
          style={{ ['--slide-panel-w' as string]: width }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-[var(--color-border)] px-4 py-4 sm:px-6 sm:py-6">
            <div className="min-w-0 space-y-1 pr-4">
              <DialogPrimitive.Title className="truncate text-base font-semibold text-[var(--color-foreground)]">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-[var(--color-muted-foreground)]">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="shrink-0 rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
