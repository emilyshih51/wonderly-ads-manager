import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-page skeleton for the dashboard — matches the exact layout:
 * header bar, 6 metric cards, 2 charts, campaign data table.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-8">
      {/* Header bar: title + selectors */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-52" />
        </div>
      </div>

      {/* 6 metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="mb-2 h-7 w-28" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 2 charts side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="mb-1 h-5 w-32" />
              <Skeleton className="mb-4 h-3 w-20" />
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Campaign table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-0">
            <Skeleton className="h-9 w-64" />
          </div>
          <div className="space-y-0 pt-2">
            {/* Header row */}
            <div className="flex gap-4 border-b border-[var(--color-border)] px-4 py-3">
              {[40, 20, 20, 20, 20, 20, 20, 20].map((w, i) => (
                <Skeleton key={i} className={`h-3`} style={{ width: `${w}px` }} />
              ))}
            </div>
            {/* Body rows */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 border-b border-[var(--color-border)] px-4 py-3">
                {[140, 60, 60, 60, 60, 60, 60, 60].map((w, j) => (
                  <Skeleton key={j} className="h-4" style={{ width: `${w}px` }} />
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
