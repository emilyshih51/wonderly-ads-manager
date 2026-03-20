import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-page skeleton for the dashboard — shows while initial data loads.
 * Matches the layout of 4 metric cards, a chart area, and a data table.
 *
 * @returns Skeleton layout matching the dashboard page structure.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-8">
      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="mb-1 h-8 w-32" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart area */}
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
