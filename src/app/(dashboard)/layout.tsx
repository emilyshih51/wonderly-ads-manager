import { Sidebar } from '@/components/layout/sidebar';
import { DashboardContent } from '@/components/layout/dashboard-content';
import { AssistantOverlay } from '@/components/assistant/assistant-overlay';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--color-background)]">
      <Sidebar />
      <DashboardContent>{children}</DashboardContent>
      <AssistantOverlay />
    </div>
  );
}
