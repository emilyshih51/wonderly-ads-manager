import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the Ads page.
 * Matches the horizontal carousel layout of AdsGallery.
 */
export function AdsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Filter bar skeleton */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>

      {/* Carousel skeleton */}
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="w-[280px] shrink-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] sm:w-[300px] lg:w-[320px]"
          >
            {/* Image area — 4:3 */}
            <Skeleton className="aspect-[4/3] w-full rounded-none" />

            {/* Card body */}
            <div className="space-y-2.5 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />

              {/* Metrics area */}
              <div className="border-t border-[var(--color-border)] pt-2">
                <Skeleton className="mb-2 h-5 w-24 rounded-full" />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div className="space-y-1">
                    <Skeleton className="h-2.5 w-10" />
                    <Skeleton className="h-3.5 w-14" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-2.5 w-18" />
                    <Skeleton className="h-3.5 w-16" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-2.5 w-8" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary skeleton */}
      <Skeleton className="h-4 w-48" />
    </div>
  );
}
