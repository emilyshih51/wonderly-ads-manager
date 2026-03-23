'use client';

import { type Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/dropdown';

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
}

/**
 * Pagination controls for DataTable — page size selector and prev/next navigation.
 *
 * @param table - TanStack table instance
 */
export function DataTablePagination<TData>({ table }: DataTablePaginationProps<TData>) {
  const tCommon = useTranslations('common');
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const totalRows = table.getFilteredRowModel().rows.length;

  const from = pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        {totalRows === 0 ? tCommon('noResults') : `${from}–${to} of ${totalRows}`}
      </p>

      <div className="flex items-center gap-1">
        <Select
          value={String(pageSize)}
          onChange={(value) => table.setPageSize(Number(value))}
          options={[10, 25, 50].map((size) => ({
            label: `${size} ${tCommon('perPage')}`,
            value: String(size),
          }))}
          className="h-8 text-xs"
        />

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
