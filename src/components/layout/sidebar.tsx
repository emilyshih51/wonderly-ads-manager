'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  LayoutDashboard,
  Megaphone,
  Layers,
  Trophy,
  Workflow,
  Settings,
  LogOut,
  MessageSquare,
  ChevronDown,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { createLogger } from '@/services/logger';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { MetaLogo } from '@/components/ui/meta-logo';
import { setLocale } from '@/i18n/actions';
import { locales, type Locale, LOCALE_COOKIE } from '@/i18n/config';
import { useAppStore } from '@/stores/app-store';

const logger = createLogger('Sidebar');

interface AdAccount {
  id: string;
  name: string;
  business_name: string | null;
  is_current: boolean;
}

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN',
  es: 'ES',
  zh: '简',
  'zh-TW': '繁',
  ja: 'JA',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<AdAccount | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<Locale>(() => {
    if (typeof document === 'undefined') return 'en';
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));

    return m ? (decodeURIComponent(m[1]) as Locale) : 'en';
  });
  const [, startTransition] = useTransition();

  const navigation = [
    { name: t('dashboard'), href: '/dashboard', icon: LayoutDashboard },
    { name: t('aiChat'), href: '/chat', icon: MessageSquare, isPrimary: true },
    { name: t('campaigns'), href: '/campaigns', icon: Megaphone },
    { name: t('launch'), href: '/adsets', icon: Layers },
    { name: t('topAds'), href: '/ads', icon: Trophy },
    { name: t('automations'), href: '/automations', icon: Workflow },
    { name: t('settings'), href: '/settings', icon: Settings },
  ];

  useEffect(() => {
    fetch('/api/meta/accounts')
      .then((r) => r.json())
      .then((data) => {
        const accts = data.data || [];

        setAccounts(accts);
        setCurrentAccount(accts.find((a: AdAccount) => a.is_current) || accts[0] || null);
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
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
      router.refresh();
      window.location.reload();
    } catch (e) {
      logger.error('Failed to switch account', e);
    } finally {
      setSwitching(false);
    }
  };

  const handleLocaleChange = (locale: Locale) => {
    setShowLangMenu(false);
    setCurrentLocale(locale);
    startTransition(async () => {
      await setLocale(locale);
      window.location.reload();
    });
  };

  const showSwitcher = !accountsLoading && accounts.length > 1;

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 z-40 h-screen bg-[var(--color-sidebar)] transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo + collapse toggle */}
        <div className="flex h-16 items-center justify-between px-4">
          <div
            className={cn(
              'flex items-center gap-2.5 overflow-hidden',
              collapsed && 'justify-center'
            )}
          >
            <MetaLogo className="h-8 w-8 shrink-0" />
            <span
              className={cn(
                'text-sm font-semibold whitespace-nowrap text-[var(--color-sidebar-foreground)] transition-opacity duration-200',
                collapsed ? 'w-0 opacity-0' : 'opacity-100'
              )}
            >
              Ads Manager
            </span>
          </div>
          <button
            onClick={toggleSidebar}
            className={cn(
              'shrink-0 rounded-md p-1 text-[var(--color-muted-foreground)] transition-colors hover:bg-white/10 hover:text-white',
              collapsed && 'absolute top-4 right-3.5'
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Account Switcher — always reserves space to prevent CLS */}
        {!collapsed && (
          <div className="mb-2 px-3">
            {accountsLoading ? (
              /* Skeleton matches the real button: bg-white/5 rounded-md px-3 py-2, two text lines + chevron */
              <div className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-20 animate-pulse rounded bg-white/[0.06]" />
                </div>
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/[0.06]" />
              </div>
            ) : showSwitcher ? (
              <div className="relative">
                <button
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md bg-white/5 px-3 py-2 text-xs transition-colors hover:bg-white/10',
                    switching && 'pointer-events-none opacity-60'
                  )}
                  disabled={switching}
                >
                  <div className="min-w-0 text-left">
                    <p className="truncate text-xs font-medium text-white">
                      {currentAccount?.name || t('selectAccount')}
                    </p>
                    {currentAccount?.business_name && (
                      <p className="truncate text-[10px] text-[var(--color-muted-foreground)]">
                        {currentAccount.business_name}
                      </p>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      'ml-2 h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-200',
                      showAccountMenu && 'rotate-180'
                    )}
                  />
                </button>

                {showAccountMenu && (
                  <div className="animate-in fade-in slide-in-from-top-1 absolute top-full right-0 left-0 z-50 mt-1.5 overflow-hidden rounded-lg border border-white/10 bg-[var(--color-sidebar)] py-1 shadow-xl duration-150">
                    {accounts.map((account) => (
                      <button
                        key={account.id}
                        onClick={() => switchAccount(account)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          account.is_current
                            ? 'text-[var(--color-primary)]'
                            : 'text-[var(--color-sidebar-foreground)] hover:bg-white/10'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{account.name}</p>
                          {account.business_name && (
                            <p className="truncate text-[10px] text-[var(--color-muted-foreground)]">
                              {account.business_name}
                            </p>
                          )}
                        </div>
                        {account.is_current && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            const isPrimary = item.isPrimary;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200',
                  collapsed && 'justify-center px-0',
                  isActive && isPrimary
                    ? 'bg-[var(--color-primary)] text-white shadow-lg shadow-blue-500/20'
                    : isActive
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-sidebar-foreground)] hover:bg-white/5 hover:text-white'
                )}
              >
                <item.icon className="h-4.5 w-4.5 flex-shrink-0" />
                {!collapsed && <span className="font-medium">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Language switcher + Theme toggle + Logout */}
        <div className="space-y-1 px-3 py-4">
          {/* Language switcher */}
          {!collapsed && (
            <div className="relative">
              <button
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] transition-colors hover:bg-white/5 hover:text-white"
              >
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span>{LOCALE_LABELS[currentLocale]}</span>
                </div>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 transition-transform duration-200',
                    showLangMenu && 'rotate-180'
                  )}
                />
              </button>

              {showLangMenu && (
                <div className="animate-in fade-in slide-in-from-bottom-1 absolute right-0 bottom-full left-0 z-50 mb-1.5 overflow-hidden rounded-lg border border-white/10 bg-[var(--color-sidebar)] py-1 shadow-xl duration-150">
                  {locales.map((locale) => (
                    <button
                      key={locale}
                      onClick={() => handleLocaleChange(locale)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors',
                        locale === currentLocale
                          ? 'text-[var(--color-primary)]'
                          : 'text-[var(--color-sidebar-foreground)] hover:bg-white/10'
                      )}
                    >
                      <span>{LOCALE_LABELS[locale]}</span>
                      {locale === currentLocale && (
                        <Check className="h-3 w-3 text-[var(--color-primary)]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {collapsed ? (
            <div className="flex justify-center py-1">
              <ThemeToggle />
            </div>
          ) : (
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-xs text-[var(--color-muted-foreground)]">{t('theme')}</span>
              <ThemeToggle />
            </div>
          )}

          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              title={collapsed ? t('signOut') : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--color-sidebar-foreground)] transition-all duration-200 hover:bg-white/5 hover:text-white',
                collapsed && 'justify-center px-0'
              )}
            >
              <LogOut className="h-4.5 w-4.5 flex-shrink-0" />
              {!collapsed && <span className="font-medium">{t('signOut')}</span>}
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
