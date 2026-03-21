'use client';

import { useState, useTransition } from 'react';
import { BarChart2, Bot, Zap, Globe, ChevronDown, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { setLocale } from '@/i18n/actions';
import { locales, type Locale, LOCALE_COOKIE } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { MetaLogo } from '@/components/ui/meta-logo';

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
};

const subscribe = () => () => {};

const getSnapshot = () => true;
const getServerSnapshot = () => false;
const useIsMounted = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export default function LoginPage() {
  const t = useTranslations('login');
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<Locale>(() => {
    if (typeof document === 'undefined') return 'en';
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));

    return m ? (decodeURIComponent(m[1]) as Locale) : 'en';
  });
  const [, startTransition] = useTransition();

  const handleLogin = () => {
    window.location.href = '/api/auth/facebook';
  };

  const handleLocaleChange = (locale: Locale) => {
    setShowLangMenu(false);
    setCurrentLocale(locale);
    startTransition(async () => {
      await setLocale(locale);
      window.location.reload();
    });
  };

  const features = [
    { icon: BarChart2, title: t('feature1Title'), desc: t('feature1Desc') },
    { icon: Zap, title: t('feature2Title'), desc: t('feature2Desc') },
    { icon: Bot, title: t('feature3Title'), desc: t('feature3Desc') },
  ];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Top bar — mobile only */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center">
            <MetaLogo className="h-7 w-7" />
          </div>
          <span className="text-sm font-semibold text-[var(--color-foreground)]">
            Wonderly Ads Manager
          </span>
        </div>
        <div className="flex items-center gap-1">
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{LOCALE_NAMES[currentLocale]}</span>
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', showLangMenu && 'rotate-180')}
              />
            </button>
            {showLangMenu && (
              <div className="absolute top-full right-0 z-50 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                {locales.map((locale) => (
                  <button
                    key={locale}
                    onClick={() => handleLocaleChange(locale)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs transition-colors',
                      locale === currentLocale
                        ? 'bg-[var(--color-primary)]/10 font-medium text-[var(--color-primary)]'
                        : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]'
                    )}
                  >
                    {LOCALE_NAMES[locale]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Left panel — dark branding (desktop) */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 to-blue-950 p-12 lg:flex lg:w-[58%]">
        {/* Background grid pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            <MetaLogo className="h-9 w-9" />
          </div>
          <span className="text-lg font-semibold text-white">Wonderly Ads Manager</span>
        </div>

        {/* Headline */}
        <div className="relative space-y-8">
          <div>
            <h1 className="text-4xl leading-tight font-bold text-white xl:text-5xl">
              {t('headline1')}
              <br />
              <span className="text-blue-400">{t('headline2')}</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-slate-400">{t('subheadline')}</p>
          </div>

          {/* Feature bullets */}
          <ul className="space-y-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/15 ring-1 ring-blue-500/25">
                  <Icon className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom attribution */}
        <p className="relative text-xs text-slate-600">
          {t('copyright', { year: new Date().getFullYear() })}
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 flex-col bg-[var(--color-background)]">
        {/* Desktop top-right controls */}
        <div className="hidden items-center justify-end gap-1 px-8 pt-6 lg:flex">
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{LOCALE_NAMES[currentLocale]}</span>
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', showLangMenu && 'rotate-180')}
              />
            </button>
            {showLangMenu && (
              <div className="absolute top-full right-0 z-50 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                {locales.map((locale) => (
                  <button
                    key={locale}
                    onClick={() => handleLocaleChange(locale)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs transition-colors',
                      locale === currentLocale
                        ? 'bg-[var(--color-primary)]/10 font-medium text-[var(--color-primary)]'
                        : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]'
                    )}
                  >
                    {LOCALE_NAMES[locale]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 sm:px-8">
          {/* Mobile feature list (collapsed on small) */}
          <div className="mb-8 w-full max-w-sm space-y-3 lg:hidden">
            <ul className="space-y-3">
              {features.map(({ icon: Icon, title, desc }) => (
                <li key={title} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/15 ring-1 ring-blue-500/25">
                    <Icon className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--color-foreground)]">{title}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="w-full max-w-sm space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-[var(--color-foreground)]">
                {t('welcomeBack')}
              </h2>
              <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{t('signInDesc')}</p>
            </div>

            <Button
              onClick={handleLogin}
              className="h-12 w-full gap-3 text-sm font-medium"
              size="lg"
            >
              {/* Facebook logo */}
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              {t('continueWithFacebook')}
            </Button>

            <p className="text-center text-xs text-[var(--color-muted-foreground)]">
              {t('restricted')}
              <br />
              {t('contactAdmin')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
