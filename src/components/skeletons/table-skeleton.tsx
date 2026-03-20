import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonProps {
  /** Number of table columns. Defaults to `6`. */
  columns?: number;
  /** Number of body rows. Defaults to `8`. */
  rows?: number;
}

/**
 * Reusable skeleton for table-based pages (Campaigns, Ads, Automations).
 *
 * @param props - Column and row count for the skeleton table.
 * @returns Skeleton layout matching a data table with header and body rows.
 */
export function TableSkeleton({ columns = 6, rows = 8 }: TableSkeletonProps) {
  // Vary column widths for visual realism
  const widths = ['w-32', 'w-20', 'w-24', 'w-16', 'w-28', 'w-20', 'w-24', 'w-16'];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/50">
                {Array.from({ length: columns }).map((_, i) => (
                  <th key={i} className="px-4 py-3">
                    <Skeleton className={`h-3 ${widths[i % widths.length]}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, row) => (
                <tr key={row} className="border-b border-[var(--color-border)]">
                  {Array.from({ length: columns }).map((_, col) => (
                    <td key={col} className="px-4 py-3">
                      <Skeleton className={`h-4 ${widths[(col + row) % widths.length]}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
