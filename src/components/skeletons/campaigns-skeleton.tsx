import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the Campaigns page.
 * Matches the layout: 4 summary stat cards + DataTable with search bar and rows.
 */
export function CampaignsSkeleton() {
  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="relative overflow-hidden">
            <div className="absolute top-0 left-0 h-full w-1 rounded-l-xl bg-[var(--color-muted)]" />
            <CardContent className="p-4 pl-3.5 md:p-5 md:pl-4">
              <Skeleton className="h-3 w-16 md:w-20" />
              <Skeleton className="mt-2 h-7 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 pb-0">
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="pt-3">
          <div className="flex gap-4 bg-[var(--color-muted)]/50 px-5 py-2.5">
            {[120, 50, 50, 40, 40, 40, 40, 50].map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${w}px` }} />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b border-[var(--color-border)] px-5 py-3">
              {[160, 60, 60, 50, 50, 50, 50, 60].map((w, j) => (
                <Skeleton key={j} className="h-4" style={{ width: `${w}px` }} />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
