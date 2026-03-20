import { cn } from '@/lib/utils';

/**
 * Pulsing placeholder block used as a loading skeleton.
 *
 * @param props - Standard div props. Use `className` to set dimensions.
 * @returns A pulsing rounded div that matches the final content layout.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200', className)} {...props} />;
}
