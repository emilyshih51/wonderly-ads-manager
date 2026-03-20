import { Sidebar } from '@/components/layout/sidebar';
import { QueryProvider } from '@/lib/queries/client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="min-h-screen bg-white">
        <Sidebar />
        <main className="ml-56">{children}</main>
      </div>
    </QueryProvider>
  );
}
