'use client';

import { type Table } from '@tanstack/react-table';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchKey?: string;
  searchPlaceholder?: string;
}

/**
 * Toolbar for DataTable — renders a search input that filters on the given column.
 *
 * @param table - TanStack table instance
 * @param searchKey - Column accessor key to filter on
 * @param searchPlaceholder - Placeholder text for the search input
 */
export function DataTableToolbar<TData>({
  table,
  searchKey,
  searchPlaceholder = 'Search...',
}: DataTableToolbarProps<TData>) {
  if (!searchKey) return null;

  const column = table.getColumn(searchKey);
  const filterValue = (column?.getFilterValue() as string) ?? '';

  return (
    <div className="flex items-center gap-2 p-4 pb-0">
      <div className="relative max-w-xs flex-1">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        <Input
          placeholder={searchPlaceholder}
          value={filterValue}
          onChange={(e) => column?.setFilterValue(e.target.value)}
          className="pl-9"
        />
      </div>
      {filterValue && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column?.setFilterValue('')}
          className="h-9 px-2"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
