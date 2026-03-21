import { Sidebar } from '@/components/layout/sidebar';
import { DashboardContent } from '@/components/layout/dashboard-content';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--color-background)]">
      <Sidebar />
      <DashboardContent>{children}</DashboardContent>
    </div>
  );
}
