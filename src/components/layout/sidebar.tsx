'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Megaphone,
  Layers,
  Trophy,
  Workflow,
  Settings,
  LogOut,
  Zap,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'AI Chat', href: '/chat', icon: MessageSquare, isPrimary: true },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Launch', href: '/adsets', icon: Layers },
  { name: 'Top Ads', href: '/ads', icon: Trophy },
  { name: 'Automations', href: '/automations', icon: Workflow },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 bg-gray-950">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Wonderly</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 px-3 py-4">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            const isPrimary = item.isPrimary;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200',
                  isActive && isPrimary
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                    : isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                )}
              >
                <item.icon className="h-4.5 w-4.5 flex-shrink-0" />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4">
          <a
            href="/api/auth/logout"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-400 transition-all duration-200 hover:text-gray-200 hover:bg-gray-800/50"
          >
            <LogOut className="h-4.5 w-4.5 flex-shrink-0" />
            <span className="font-medium">Sign Out</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
