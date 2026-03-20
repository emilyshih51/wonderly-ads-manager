'use client';

import { SelectNative } from '@/components/ui/select-native';
import { useAppStore } from '@/stores/app-store';
import { DATE_PRESETS } from '@/lib/utils';

interface HeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function Header({ title, description, children }: HeaderProps) {
  const { datePreset, setDatePreset } = useAppStore();

  return (
    <div className="flex items-center justify-between border-b border-(--color-border) bg-[var(--color-card)] px-8 py-5">
      <div>
        <h1 className="text-2xl font-bold text-(--color-foreground)">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-(--color-muted-foreground)">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <SelectNative
          value={datePreset}
          onChange={(e) => setDatePreset(e.target.value)}
          options={DATE_PRESETS}
          className="w-40"
        />
        {children}
      </div>
    </div>
  );
}
