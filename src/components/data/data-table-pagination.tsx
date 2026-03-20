'use client';

import { type Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
}

/**
 * Pagination controls for DataTable — page size selector and prev/next navigation.
 *
 * @param table - TanStack table instance
 */
export function DataTablePagination<TData>({ table }: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const totalRows = table.getFilteredRowModel().rows.length;

  const from = pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        {totalRows === 0 ? 'No results' : `${from}–${to} of ${totalRows}`}
      </p>

      <div className="flex items-center gap-1">
        <select
          value={pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="h-8 rounded-md border border-[var(--color-input)] bg-[var(--color-card)] px-2 text-xs text-[var(--color-foreground)] focus:outline-none"
        >
          {[10, 25, 50].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="min-w-[4rem] text-center text-xs text-[var(--color-muted-foreground)]">
          {pageCount === 0 ? '0 / 0' : `${pageIndex + 1} / ${pageCount}`}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
