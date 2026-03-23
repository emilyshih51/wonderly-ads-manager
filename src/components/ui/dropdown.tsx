'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dropdown = DropdownMenuPrimitive.Root;
const DropdownTrigger = DropdownMenuPrimitive.Trigger;
const DropdownPortal = DropdownMenuPrimitive.Portal;

const DropdownContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownPortal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[8rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-md',
        'data-[state=open]:animate-[dropdown-in_150ms_ease-out]',
        'data-[state=closed]:animate-[dropdown-out_100ms_ease-in]',
        className
      )}
      {...props}
    />
  </DropdownPortal>
));

DropdownContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm text-[var(--color-foreground)] transition-colors outline-none select-none',
      'focus:bg-[var(--color-accent)] focus:text-[var(--color-accent-foreground)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  />
));

DropdownItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)]',
      className
    )}
    {...props}
  />
));

DropdownLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-[var(--color-border)]', className)}
    {...props}
  />
));

DropdownSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

/** Props for the styled Select component built on Dropdown. */
interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Styled select built on Radix DropdownMenu.
 * Use in place of SelectNative where visual styling matters (header, sidebar, filters).
 *
 * @param value - Currently selected value
 * @param onChange - Called with the new value when selection changes
 * @param options - Array of label/value pairs
 * @param placeholder - Text shown when no value selected
 * @param className - Additional classes for the trigger button
 * @param disabled - Whether the select is disabled
 */
function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  disabled,
}: SelectProps) {
  const selected = options.find((o) => o.value === value);

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            'flex h-10 items-center justify-between gap-2 rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-foreground)] transition-colors',
            'hover:bg-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className={cn('text-left', !selected && 'text-[var(--color-muted-foreground)]')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
        </button>
      </DropdownTrigger>
      <DropdownContent className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
        {options.map((option) => (
          <DropdownItem
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(option.value === value && 'bg-[var(--color-accent)]')}
          >
            <span className="flex-1">{option.label}</span>
            {option.value === value && (
              <Check className="ml-2 h-3.5 w-3.5 text-[var(--color-primary)]" />
            )}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

export {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  Select,
};
