import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for the Automations page.
 * Matches the 2-column layout: rules list on the left, flow editor on the right.
 */
export function AutomationsSkeleton() {
  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-10 w-36" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Rules list */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-6 w-10 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Flow editor placeholder */}
        <Card>
          <CardContent className="flex h-96 items-center justify-center p-6">
            <div className="text-center">
              <Skeleton className="mx-auto mb-3 h-12 w-12 rounded-xl" />
              <Skeleton className="mx-auto h-4 w-40" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
