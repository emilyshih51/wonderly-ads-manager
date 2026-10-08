'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/dropdown';
import { useAppStore } from '@/stores/app-store';
import { DATE_PRESETS } from '@/lib/utils';

interface HeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** Show the global date-range picker (default true). Off for pages that don't use it. */
  showDatePreset?: boolean;
}

export function Header({ title, description, children, showDatePreset = true }: HeaderProps) {
  const tCommon = useTranslations('common');
  const { datePreset, setDatePreset } = useAppStore();

  return (
    <div className="flex items-center gap-3 border-b border-(--color-border) bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8">
      <div className="min-w-0 shrink-0">
        <h1 className="truncate text-base font-semibold text-(--color-foreground) sm:text-lg">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 hidden truncate text-xs text-(--color-muted-foreground) md:block">
            {description}
          </p>
        )}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {showDatePreset && (
          <Select
            value={datePreset}
            onChange={setDatePreset}
            options={DATE_PRESETS.map((p) => ({ label: tCommon(p.labelKey), value: p.value }))}
            className="h-8 shrink-0 text-xs sm:text-sm"
          />
        )}
        {children}
      </div>
    </div>
  );
}
