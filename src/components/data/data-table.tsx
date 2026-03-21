'use client';

import * as React from 'react';
import {
  type ColumnDef,
  type Row,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
  type ExpandedState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTableToolbar } from '@/components/data/data-table-toolbar';
import { DataTablePagination } from '@/components/data/data-table-pagination';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Title shown in the table header bar. */
  title?: string;
  /** Action element rendered on the right side of the header bar (e.g. a back button). */
  headerAction?: React.ReactNode;
  searchKey?: string;
  searchPlaceholder?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  pagination?: boolean;
  pageSize?: number;
  onRowClick?: (row: TData) => void;
  renderSubRow?: (row: Row<TData>) => React.ReactNode;
  getRowCanExpand?: (row: Row<TData>) => boolean;
  className?: string;
}

/**
 * Generic data table built on TanStack Table v8.
 * Supports sorting, column filtering, global search, pagination, and row expansion.
 *
 * @param columns - Column definitions
 * @param data - Row data array
 * @param searchKey - Column accessor key for the search filter
 * @param searchPlaceholder - Placeholder for the search input
 * @param isLoading - Renders loading skeleton when true
 * @param emptyMessage - Message shown when no rows match filters
 * @param pagination - Enable pagination (default true)
 * @param pageSize - Initial page size (default 25)
 * @param onRowClick - Called when a data row is clicked
 * @param renderSubRow - Renders the expanded sub-row content
 * @param getRowCanExpand - Controls which rows are expandable (default: all when renderSubRow provided)
 * @param className - Additional classes for the Card wrapper
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  title,
  headerAction,
  searchKey,
  searchPlaceholder,
  isLoading = false,
  emptyMessage = 'No results.',
  pagination = true,
  pageSize = 25,
  onRowClick,
  renderSubRow,
  getRowCanExpand,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  // Prepend expand-toggle column when sub-rows are enabled
  const allColumns: ColumnDef<TData, TValue>[] = React.useMemo(() => {
    if (!renderSubRow) return columns;
    const expandCol: ColumnDef<TData, TValue> = {
      id: '_expand',
      header: () => null,
      cell: ({ row }) =>
        row.getCanExpand() ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Toggle row"
          >
            {row.getIsExpanded() ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : null,
      size: 40,
    };

    return [expandCol, ...columns];
  }, [columns, renderSubRow]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns unstable function refs; React Compiler skips this component intentionally
  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnFilters, expanded },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: pagination ? getPaginationRowModel() : undefined,
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: getRowCanExpand ?? (renderSubRow ? () => true : undefined),
    initialState: { pagination: { pageSize } },
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <div className="space-y-3 p-4">
          <Skeleton className="h-9 w-64" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      {(title || headerAction) && (
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 md:px-5">
          {title && <h3 className="text-sm font-medium text-[var(--color-foreground)]">{title}</h3>}
          {headerAction && <div className="ml-auto">{headerAction}</div>}
        </div>
      )}
      <DataTableToolbar table={table} searchKey={searchKey} searchPlaceholder={searchPlaceholder} />

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();

                return (
                  <TableHead key={header.id} style={{ minWidth: header.column.columnDef.minSize }}>
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        className="flex items-center gap-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase hover:text-[var(--color-foreground)]"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={allColumns.length}
                className="py-10 text-center text-[var(--color-muted-foreground)]"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow
                  data-state={row.getIsSelected() && 'selected'}
                  className={cn('group/row', onRowClick && 'cursor-pointer')}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>

                {row.getIsExpanded() && renderSubRow && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={allColumns.length} className="p-0">
                      {renderSubRow(row)}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>

      {pagination && <DataTablePagination table={table} />}
    </Card>
  );
}
