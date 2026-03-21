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
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { createLogger } from '@/services/logger';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { MetaLogo } from '@/components/ui/meta-logo';
import { setLocale } from '@/i18n/actions';
import { locales, type Locale, LOCALE_COOKIE } from '@/i18n/config';

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
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<AdAccount | null>(null);
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
      // Full reload so the server re-renders with the new locale messages
      window.location.reload();
    });
  };

  return (
    <aside className="fixed top-0 left-0 z-40 h-screen w-56 bg-[var(--color-sidebar)]">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 px-6">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10 p-1">
            <MetaLogo className="h-full w-full" />
          </div>
          <span className="text-sm font-semibold text-[var(--color-sidebar-foreground)]">
            Ads Manager
          </span>
        </div>

        {/* Account Switcher */}
        {accounts.length > 1 && (
          <div className="relative mb-2 px-3">
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="flex w-full items-center justify-between rounded-md bg-white/5 px-3 py-2 text-xs text-[var(--color-sidebar-foreground)] transition-colors hover:bg-white/10"
              disabled={switching}
            >
              <div className="truncate text-left">
                <p className="truncate font-medium text-white">
                  {currentAccount?.name || t('selectAccount')}
                </p>
                {currentAccount?.business_name && (
                  <p className="truncate text-[var(--color-muted-foreground)]">
                    {currentAccount.business_name}
                  </p>
                )}
              </div>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 text-[var(--color-muted-foreground)] transition-transform',
                  showAccountMenu && 'rotate-180'
                )}
              />
            </button>

            {showAccountMenu && (
              <div className="absolute top-full right-3 left-3 z-50 mt-1 overflow-hidden rounded-md border border-white/10 bg-[var(--color-sidebar)] shadow-xl">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => switchAccount(account)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs transition-colors',
                      account.is_current
                        ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]'
                        : 'text-[var(--color-sidebar-foreground)] hover:bg-white/10'
                    )}
                  >
                    <p className="truncate font-medium">{account.name}</p>
                    {account.business_name && (
                      <p className="truncate text-[var(--color-muted-foreground)]">
                        {account.business_name}
                      </p>
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
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200',
                  isActive && isPrimary
                    ? 'bg-[var(--color-primary)] text-white shadow-lg shadow-blue-500/20'
                    : isActive
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-sidebar-foreground)] hover:bg-white/5 hover:text-white'
                )}
              >
                <item.icon className="h-4.5 w-4.5 flex-shrink-0" />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Language switcher + Theme toggle + Logout */}
        <div className="space-y-1 px-3 py-4">
          {/* Language switcher */}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] transition-colors hover:bg-white/5 hover:text-white"
            >
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{LOCALE_LABELS[currentLocale]}</span>
              </div>
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', showLangMenu && 'rotate-180')}
              />
            </button>

            {showLangMenu && (
              <div className="absolute right-0 bottom-full left-0 z-50 mb-1 overflow-hidden rounded-md border border-white/10 bg-[var(--color-sidebar)] shadow-xl">
                {locales.map((locale) => (
                  <button
                    key={locale}
                    onClick={() => handleLocaleChange(locale)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs transition-colors',
                      locale === currentLocale
                        ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]'
                        : 'text-[var(--color-sidebar-foreground)] hover:bg-white/10'
                    )}
                  >
                    {LOCALE_LABELS[locale]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-[var(--color-muted-foreground)]">{t('theme')}</span>
            <ThemeToggle />
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--color-sidebar-foreground)] transition-all duration-200 hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-4.5 w-4.5 flex-shrink-0" />
              <span className="font-medium">{t('signOut')}</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
