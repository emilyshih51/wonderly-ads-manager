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
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />

        {/* Panel */}
        <DialogPrimitive.Content
          className={cn(
            'fixed top-0 right-0 z-50 flex h-full flex-col border-l border-[var(--color-border)] bg-[var(--color-card)] shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            'duration-300'
          )}
          style={{ width }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-[var(--color-border)] p-6">
            <div className="space-y-1 pr-8">
              <DialogPrimitive.Title className="text-base font-semibold text-[var(--color-foreground)]">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-[var(--color-muted-foreground)]">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
