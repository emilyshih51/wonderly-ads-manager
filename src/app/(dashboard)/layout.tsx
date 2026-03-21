import { Sidebar } from '@/components/layout/sidebar';
import { DashboardContent } from '@/components/layout/dashboard-content';
import { QueryProvider } from '@/lib/queries/client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="h-[100dvh] overflow-hidden bg-[var(--color-background)]">
        <Sidebar />
        <DashboardContent>{children}</DashboardContent>
      </div>
    </QueryProvider>
  );
}
