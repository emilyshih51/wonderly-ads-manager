'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 shadow-sm',
        destructive: 'bg-[var(--color-destructive)] text-white hover:opacity-90 shadow-sm',
        outline:
          'border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] text-[var(--color-foreground)]',
        secondary:
          'bg-[var(--color-accent)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/80',
        ghost: 'hover:bg-[var(--color-accent)] text-[var(--color-foreground)]',
        link: 'text-[var(--color-primary)] underline-offset-4 hover:underline',
        success:
          'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm dark:bg-emerald-500 dark:hover:bg-emerald-600',
        'outline-success':
          'border border-emerald-300/60 bg-transparent text-emerald-600 hover:border-emerald-400/80 hover:bg-emerald-500/10 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:border-emerald-500/60 dark:hover:bg-emerald-500/10',
        'outline-danger':
          'border border-red-300/60 bg-transparent text-red-500 hover:border-red-400/80 hover:bg-red-500/10 dark:border-red-500/40 dark:text-red-400 dark:hover:border-red-500/60 dark:hover:bg-red-500/10',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
