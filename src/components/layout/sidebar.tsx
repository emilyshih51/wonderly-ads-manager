'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  useCallback,
  type ReactNode,
  type RefObject,
} from 'react';
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
  ChevronsLeft,
  ChevronsRight,
  Check,
  Menu,
  X,
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

/**
 * Tooltip that appears to the right of a sidebar item when collapsed.
 * CSS-only — no JS positioning needed since the sidebar is fixed-left.
 */
function SidebarTooltip({ label, children }: { label: string; children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const handleEnter = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();

    setPos({
      top: rect.top + rect.height / 2,
      left: rect.right + 10,
    });
    setShow(true);
  };

  return (
    <div ref={wrapperRef} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {show &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999]"
            style={{ top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
          >
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-y-[5px] border-r-[5px] border-y-transparent border-r-[var(--color-foreground)]" />
            <div className="rounded-md bg-[var(--color-foreground)] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--color-background)] shadow-lg">
              {label}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** Wraps children in SidebarTooltip only when collapsed. */
function MaybeTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;

  return <SidebarTooltip label={label}>{children}</SidebarTooltip>;
}

interface AdAccount {
  id: string;
  name: string;
  business_name: string | null;
  is_current: boolean;
}

const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  es: 'ES',
  zh: '简',
  'zh-TW': '繁',
  ja: 'JA',
  fr: 'FR',
  de: 'DE',
  ko: '한',
  pt: 'PT',
};

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  fr: 'Français',
  de: 'Deutsch',
  ko: '한국어',
  pt: 'Português',
};

/* ------------------------------------------------------------------ */
/*  Smart portal dropdown — auto-positions within viewport             */
/* ------------------------------------------------------------------ */

/**
 * Preferred placement relative to trigger:
 *  - "below"  → try below, flip above if no space
 *  - "above"  → try above, flip below if no space
 *  - "right"  → try right of trigger, flip left if no space
 */
type Placement = 'below' | 'above' | 'right';

function computePosition(
  trigger: DOMRect,
  ph: number,
  pw: number,
  placement: Placement,
  gap = 6
): { top: number; left: number } {
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  let top: number;
  let left: number;

  if (placement === 'right') {
    left = trigger.right + gap;
    top = trigger.top;
    if (left + pw > vw) left = trigger.left - pw - gap;
    if (top + ph > vh) top = vh - ph - 8;
    if (top < 8) top = 8;
  } else if (placement === 'below') {
    top = trigger.bottom + gap;
    left = trigger.left;
    if (top + ph > vh) top = trigger.top - ph - gap;
    if (top < 8) top = 8;
    if (left + pw > vw) left = vw - pw - 8;
  } else {
    top = trigger.top - ph - gap;
    left = trigger.left;
    if (top < 8) top = trigger.bottom + gap;
    if (top + ph > vh) top = vh - ph - 8;
    if (left + pw > vw) left = vw - pw - 8;
  }

  return { top, left };
}

function useDropdown() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((p) => !p), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      )
        return;
      close();
    };

    document.addEventListener('mousedown', handler);

    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Close on Escape / resize / scroll
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('keydown', handler);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    return () => {
      document.removeEventListener('keydown', handler);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, close]);

  return { triggerRef, panelRef, open, toggle, close };
}

interface DropdownPanelProps {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  placement: Placement;
  width: number;
  children: ReactNode;
}

function DropdownPanel({
  open,
  triggerRef,
  panelRef,
  placement,
  width,
  children,
}: DropdownPanelProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset on close

      return;
    }

    // Wait one frame so the panel is in the DOM with real dimensions
    const id = requestAnimationFrame(() => {
      const el = triggerRef.current;
      const panel = panelRef.current;

      if (!el || !panel) return;
      setPos(computePosition(el.getBoundingClientRect(), panel.offsetHeight, width, placement));
    });

    return () => cancelAnimationFrame(id);
  }, [open, placement, triggerRef, panelRef, width]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        zIndex: 9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="sidebar-dropdown-down overflow-hidden rounded-lg border border-white/10 bg-[var(--color-sidebar)] py-1 shadow-xl"
    >
      {children}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<AdAccount | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<Locale>(() => {
    if (typeof document === 'undefined') return 'en';
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));

    return m ? (decodeURIComponent(m[1]) as Locale) : 'en';
  });
  const [, startTransition] = useTransition();

  const accountDropdown = useDropdown();
  const langDropdown = useDropdown();

  // Close dropdowns when collapsed state changes
  useEffect(() => {
    accountDropdown.close();
    langDropdown.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on collapsed change
  }, [collapsed]);

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

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const switchAccount = async (account: AdAccount) => {
    setSwitching(true);
    accountDropdown.close();

    try {
      await fetch('/api/meta/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: account.id }),
      });
      setCurrentAccount(account);
      setAccounts((prev) => prev.map((a) => ({ ...a, is_current: a.id === account.id })));
      router.refresh();
    } catch (e) {
      logger.error('Failed to switch account', e);
    } finally {
      setSwitching(false);
    }
  };

  const handleLocaleChange = (locale: Locale) => {
    langDropdown.close();
    setCurrentLocale(locale);
    startTransition(async () => {
      await setLocale(locale);
      window.location.reload();
    });
  };

  const showSwitcher = !accountsLoading && accounts.length > 1;

  const sidebarContent = (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Logo — hidden on mobile since the top bar already shows it */}
      <div className="hidden h-16 shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-5 md:flex">
        <MetaLogo className="h-8 w-8 shrink-0" />
        <span className="text-sm font-semibold whitespace-nowrap text-[var(--color-sidebar-foreground)]">
          {t('adsManager')}
        </span>
      </div>

      {/* Account Switcher — fixed height to prevent layout shift */}
      <div className="shrink-0 px-3 pt-4 pb-2">
        {collapsed ? (
          /* Collapsed: show initial or loaded state in same-height container */
          showSwitcher ? (
            <>
              <SidebarTooltip label={currentAccount?.name || t('selectAccount')}>
                <button
                  ref={accountDropdown.triggerRef}
                  onClick={accountDropdown.toggle}
                  className={cn(
                    'flex h-9 w-full items-center justify-center rounded-md bg-white/5 transition-colors hover:bg-white/10',
                    switching && 'pointer-events-none opacity-60'
                  )}
                  disabled={switching}
                >
                  <span className="text-xs font-semibold text-white">
                    {(currentAccount?.name || '?').charAt(0).toUpperCase()}
                  </span>
                </button>
              </SidebarTooltip>
              <DropdownPanel
                open={accountDropdown.open}
                triggerRef={accountDropdown.triggerRef}
                panelRef={accountDropdown.panelRef}
                placement="right"
                width={208}
              >
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
              </DropdownPanel>
            </>
          ) : (
            /* Collapsed: loading or single account — reserve same height */
            <div className="h-9" />
          )
        ) : (
          /* Expanded: fixed-height container for skeleton → real → empty */
          <div className="h-[42px]">
            {accountsLoading ? (
              <div className="flex h-full items-center justify-between rounded-md bg-white/5 px-3">
                <div className="space-y-1.5">
                  <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                  <div className="h-2.5 w-16 animate-pulse rounded bg-white/[0.06]" />
                </div>
                <div className="h-3 w-3 animate-pulse rounded bg-white/[0.06]" />
              </div>
            ) : showSwitcher ? (
              <>
                <button
                  ref={accountDropdown.triggerRef}
                  onClick={accountDropdown.toggle}
                  className={cn(
                    'flex h-full w-full items-center justify-between rounded-md bg-white/5 px-3 text-xs transition-colors hover:bg-white/10',
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
                      accountDropdown.open && 'rotate-180'
                    )}
                  />
                </button>
                <DropdownPanel
                  open={accountDropdown.open}
                  triggerRef={accountDropdown.triggerRef}
                  panelRef={accountDropdown.panelRef}
                  placement="below"
                  width={208}
                >
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
                </DropdownPanel>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Navigation — scrolls independently */}
      <nav className="sidebar-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-5">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          const isPrimary = item.isPrimary;

          const link = (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap',
                collapsed && 'justify-center px-2',
                isActive && isPrimary
                  ? 'bg-[var(--color-primary)] text-white shadow-lg shadow-blue-500/20'
                  : isActive
                    ? 'bg-white/10 text-white'
                    : 'text-[var(--color-sidebar-foreground)] hover:bg-white/5 hover:text-white'
              )}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              {!collapsed && <span className="font-medium">{item.name}</span>}
            </Link>
          );

          return collapsed ? (
            <SidebarTooltip key={item.href} label={item.name}>
              {link}
            </SidebarTooltip>
          ) : (
            link
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="shrink-0 space-y-1.5 border-t border-white/[0.06] px-3 py-4">
        {/* Language switcher */}
        <div>
          <MaybeTooltip collapsed={collapsed} label={t('language')}>
            <button
              ref={langDropdown.triggerRef}
              onClick={langDropdown.toggle}
              className={cn(
                'flex w-full items-center rounded-lg py-2 text-xs whitespace-nowrap text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-white',
                collapsed ? 'justify-center px-2' : 'justify-between px-3'
              )}
            >
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                {!collapsed && <span>{LOCALE_SHORT[currentLocale]}</span>}
              </div>
              {!collapsed && (
                <ChevronDown
                  className={cn(
                    'h-3 w-3 shrink-0 transition-transform duration-200',
                    langDropdown.open && 'rotate-180'
                  )}
                />
              )}
            </button>
          </MaybeTooltip>

          <DropdownPanel
            open={langDropdown.open}
            triggerRef={langDropdown.triggerRef}
            panelRef={langDropdown.panelRef}
            placement={collapsed ? 'right' : 'above'}
            width={160}
          >
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
                <span>{LOCALE_NAMES[locale]}</span>
                {locale === currentLocale && (
                  <Check className="h-3 w-3 text-[var(--color-primary)]" />
                )}
              </button>
            ))}
          </DropdownPanel>
        </div>

        {/* Theme toggle */}
        <MaybeTooltip collapsed={collapsed} label={t('theme')}>
          {collapsed ? (
            <div className="flex justify-center py-1.5">
              <ThemeToggle />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg px-3 py-2 whitespace-nowrap">
              <span className="text-xs text-[var(--color-muted-foreground)]">{t('theme')}</span>
              <ThemeToggle />
            </div>
          )}
        </MaybeTooltip>

        {/* Collapse toggle — hidden on mobile */}
        <MaybeTooltip collapsed={collapsed} label={collapsed ? t('expand') : ''}>
          <button
            onClick={toggleSidebar}
            className={cn(
              'hidden w-full items-center gap-3 rounded-lg py-2.5 text-sm whitespace-nowrap text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-white md:flex',
              collapsed ? 'justify-center px-2' : 'px-3'
            )}
          >
            {collapsed ? (
              <ChevronsRight className="h-4.5 w-4.5 shrink-0" />
            ) : (
              <>
                <ChevronsLeft className="h-4.5 w-4.5 shrink-0" />
                <span className="font-medium">{t('collapse')}</span>
              </>
            )}
          </button>
        </MaybeTooltip>

        {/* Logout */}
        <MaybeTooltip collapsed={collapsed} label={t('signOut')}>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className={cn(
                'flex w-full items-center gap-3 rounded-lg py-2.5 text-sm whitespace-nowrap text-[var(--color-sidebar-foreground)] hover:bg-white/5 hover:text-white',
                collapsed ? 'justify-center px-2' : 'px-3'
              )}
            >
              <LogOut className="h-4.5 w-4.5 shrink-0" />
              {!collapsed && <span className="font-medium">{t('signOut')}</span>}
            </button>
          </form>
        </MaybeTooltip>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed top-0 right-0 left-0 z-50 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] px-4 md:hidden">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-md p-1.5 text-[var(--color-sidebar-foreground)] hover:bg-white/10"
          aria-label={t('toggleMenu')}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <MetaLogo className="h-6 w-6 shrink-0" />
        <span className="text-sm font-semibold text-[var(--color-sidebar-foreground)]">
          {t('adsManager')}
        </span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Single sidebar — mobile: slide-in drawer, desktop: fixed collapsible panel */}
      <aside
        className={cn(
          'fixed left-0 z-50 w-56 overflow-hidden bg-[var(--color-sidebar)] transition-[width,transform] duration-200 ease-in-out',
          // Mobile: drawer below top bar, explicit height
          'top-[calc(3.5rem-1px)] h-[calc(100dvh-3.5rem+1px)]',
          // Desktop: full viewport height from top
          'md:top-0 md:z-40 md:h-[100dvh] md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-56',
          // Mobile slide
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
