'use client';

import { useAppStore } from '@/stores/app-store';
import { cn } from '@/lib/utils';

export function DashboardContent({ children }: { children: React.ReactNode }) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <main
      className={cn(
        'h-[100dvh] overflow-y-auto pt-14 transition-[margin-left] duration-200 ease-in-out md:pt-0',
        collapsed ? 'md:ml-16' : 'md:ml-56'
      )}
    >
      {children}
    </main>
  );
}
