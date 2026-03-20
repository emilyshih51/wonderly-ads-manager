import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the Campaigns page.
 * Matches the layout: header + search bar + table (9 columns × 6 rows).
 */
export function CampaignsSkeleton() {
  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-0">
            <Skeleton className="h-9 w-64" />
          </div>
          <div className="pt-2">
            <div className="flex gap-3 border-b border-[var(--color-border)] px-4 py-3">
              {[140, 60, 80, 60, 60, 60, 60, 60, 40].map((w, i) => (
                <Skeleton key={i} className="h-3" style={{ width: `${w}px` }} />
              ))}
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 border-b border-[var(--color-border)] px-4 py-3.5">
                {[140, 60, 80, 60, 60, 60, 60, 60, 40].map((w, j) => (
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
