import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-page skeleton for the dashboard — matches the exact final layout.
 */
export function DashboardSkeleton() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 md:px-8 md:py-5">
        <div>
          <Skeleton className="h-7 w-36 md:h-8" />
          <Skeleton className="mt-1.5 hidden h-4 w-56 sm:block" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-52" />
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-6 lg:p-8">
        {/* 6 metric cards — 2 cols mobile, 3 cols sm+ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 h-full w-1 rounded-l-xl bg-[var(--color-muted)]" />
              <CardContent className="p-4 pl-3.5 md:p-5 md:pl-4">
                <div className="mb-2 flex items-center justify-between md:mb-3">
                  <Skeleton className="h-3 w-16 md:h-3.5 md:w-20" />
                  <Skeleton className="h-7 w-7 rounded-lg md:h-8 md:w-8" />
                </div>
                <Skeleton className="mb-1.5 h-6 w-24 md:mb-2 md:h-7" />
                <Skeleton className="h-3.5 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts section — action bar + 2 charts */}
        <div>
          <div className="mb-3 flex justify-end gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <Card key={i}>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-1 md:px-5">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-6 w-6 rounded-md" />
                      <Skeleton className="h-8 w-32 rounded-md md:w-36" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-7 w-7 rounded-md" />
                      <Skeleton className="h-7 w-7 rounded-md" />
                    </div>
                  </div>
                  <div className="px-2 pb-3 md:px-3">
                    <Skeleton className="h-[240px] w-full rounded-lg" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Campaign table */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 md:px-5">
            <Skeleton className="h-5 w-44" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--color-muted)]/50">
                  {[80, 50, 50, 40, 40, 40, 40, 50].map((w, i) => (
                    <th key={i} className="px-4 py-2.5 first:px-5">
                      <Skeleton className="h-3" style={{ width: `${w}px` }} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {[160, 60, 60, 50, 50, 50, 50, 60].map((w, j) => (
                      <td key={j} className="px-4 py-3 first:px-5">
                        <Skeleton className="h-4" style={{ width: `${w}px` }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
