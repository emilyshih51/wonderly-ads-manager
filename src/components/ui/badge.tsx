import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-blue-100 text-blue-700',
        active: 'bg-emerald-100 text-emerald-700',
        paused: 'bg-amber-100 text-amber-700',
        deleted: 'bg-red-100 text-red-700',
        secondary: 'bg-[var(--color-accent)] text-[var(--color-muted-foreground)]',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'ACTIVE'
      ? 'active'
      : status === 'PAUSED'
        ? 'paused'
        : status === 'DELETED'
          ? 'deleted'
          : 'secondary';

  return <Badge variant={variant}>{status}</Badge>;
}

export { Badge, badgeVariants };
