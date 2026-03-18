'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdAccount {
  id: string;
  name: string;
  business_name: string | null;
  is_current: boolean;
}

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
  const router = useRouter();
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<AdAccount | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch('/api/meta/accounts')
      .then((r) => r.json())
      .then((data) => {
        const accts = data.data || [];
        setAccounts(accts);
        setCurrentAccount(accts.find((a: AdAccount) => a.is_current) || accts[0] || null);
      })
      .catch(() => {});
  }, []);

  const switchAccount = async (account: AdAccount) => {
    setSwitching(true);
    setShowAccountMenu(false);
    try {
      await fetch('/api/meta/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: account.id }),
      });
      setCurrentAccount(account);
      setAccounts((prev) => prev.map((a) => ({ ...a, is_current: a.id === account.id })));
      // Reload the current page to refresh data for new account
      router.refresh();
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch account:', e);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 bg-gray-950">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Ads Manager</span>
        </div>

        {/* Account Switcher */}
        {accounts.length > 1 && (
          <div className="px-3 mb-2 relative">
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-gray-800/80 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
              disabled={switching}
            >
              <div className="truncate text-left">
                <p className="font-medium text-white truncate">{currentAccount?.name || 'Select account'}</p>
                {currentAccount?.business_name && (
                  <p className="text-gray-500 truncate">{currentAccount.business_name}</p>
                )}
              </div>
              <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-transform', showAccountMenu && 'rotate-180')} />
            </button>

            {showAccountMenu && (
              <div className="absolute left-3 right-3 top-full mt-1 bg-gray-900 border border-gray-700 rounded-md shadow-xl z-50 overflow-hidden">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => switchAccount(account)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs transition-colors',
                      account.is_current
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'text-gray-300 hover:bg-gray-800'
                    )}
                  >
                    <p className="font-medium truncate">{account.name}</p>
                    {account.business_name && (
                      <p className="text-gray-500 truncate">{account.business_name}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
