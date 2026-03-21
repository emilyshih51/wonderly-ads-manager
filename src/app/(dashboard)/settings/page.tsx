'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Copy, Check, Globe, Type } from 'lucide-react';
import { MetaLogo } from '@/components/ui/meta-logo';
import { useSlackStatus } from '@/lib/queries/slack/use-slack';
import { useTranslations } from 'next-intl';
import { setLocale } from '@/i18n/actions';
import { setFont } from '@/lib/font-actions';
import { locales, type Locale, LOCALE_COOKIE } from '@/i18n/config';
import { fonts, type FontChoice, FONT_COOKIE, defaultFont } from '@/lib/font-config';

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
};

const FONT_NAMES: Record<FontChoice, string> = {
  'noto-sans': 'Noto Sans (recommended)',
  inter: 'Inter',
  'jetbrains-mono': 'JetBrains Mono',
};

export default function SettingsPage() {
  const t = useTranslations('settings');
  const { data: slackStatus, isLoading: slackLoading } = useSlackStatus();
  const slackBotConfigured = slackStatus?.configured ?? false;
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [currentLocale, setCurrentLocale] = useState<Locale>(() => {
    if (typeof document === 'undefined') return 'en';
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));

    return m ? (decodeURIComponent(m[1]) as Locale) : 'en';
  });
  const [currentFont, setCurrentFont] = useState<FontChoice>(() => {
    if (typeof document === 'undefined') return defaultFont;
    const m = document.cookie.match(new RegExp(`(?:^|; )${FONT_COOKIE}=([^;]*)`));

    return m ? (decodeURIComponent(m[1]) as FontChoice) : defaultFont;
  });
  const [, startTransition] = useTransition();

  const eventUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/slack/events`;
  const interactionUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/slack/interactions`;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(id);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleLocaleChange = (locale: Locale) => {
    setCurrentLocale(locale);
    startTransition(async () => {
      await setLocale(locale);
      window.location.reload();
    });
  };

  const handleFontChange = (font: FontChoice) => {
    setCurrentFont(font);
    startTransition(async () => {
      await setFont(font);
      window.location.reload();
    });
  };

  return (
    <div className="max-w-3xl p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t('description')}</p>
      </div>

      <div className="space-y-6">
        {/* Appearance */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-muted)]">
                <Type className="h-5 w-5 text-[var(--color-muted-foreground)]" />
              </div>
              <div>
                <CardTitle className="text-base">{t('appearance')}</CardTitle>
                <CardDescription>{t('languageDesc')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Language */}
            <div>
              <p className="mb-2 text-sm font-medium text-[var(--color-foreground)]">
                <Globe className="mr-1.5 inline h-4 w-4" />
                {t('language')}
              </p>
              <div className="flex flex-wrap gap-2">
                {locales.map((locale) => (
                  <button
                    key={locale}
                    onClick={() => handleLocaleChange(locale)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      locale === currentLocale
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-medium text-[var(--color-primary)]'
                        : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-primary)]/50'
                    }`}
                  >
                    {LOCALE_NAMES[locale]}
                  </button>
                ))}
              </div>
            </div>

            {/* Font */}
            <div>
              <p className="mb-2 text-sm font-medium text-[var(--color-foreground)]">{t('font')}</p>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">{t('fontDesc')}</p>
              <div className="flex flex-wrap gap-2">
                {fonts.map((font) => (
                  <button
                    key={font}
                    onClick={() => handleFontChange(font)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      font === currentFont
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-medium text-[var(--color-primary)]'
                        : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-primary)]/50'
                    }`}
                  >
                    {FONT_NAMES[font]}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Slack Bot Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4A154B]/10">
                  {/* Slack logo */}
                  <svg className="h-5 w-5" viewBox="0 0 54 54" fill="none">
                    <path
                      d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386"
                      fill="#36C5F0"
                    />
                    <path
                      d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387"
                      fill="#2EB67D"
                    />
                    <path
                      d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386"
                      fill="#ECB22E"
                    />
                    <path
                      d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.249m14.336 0v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.249a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387"
                      fill="#E01E5A"
                    />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">{t('slackBot')}</CardTitle>
                  <CardDescription>{t('slackBotDesc')}</CardDescription>
                </div>
              </div>
              {slackLoading ? (
                <div className="h-5 w-20 animate-pulse rounded bg-[var(--color-muted)]" />
              ) : slackBotConfigured ? (
                <Badge variant="active">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> {t('configured')}
                </Badge>
              ) : (
                <Badge variant="secondary">{t('notConfigured')}</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {slackLoading ? (
              <div className="space-y-3">
                <div className="h-4 w-64 animate-pulse rounded bg-[var(--color-muted)]" />
                <div className="h-4 w-48 animate-pulse rounded bg-[var(--color-muted)]" />
              </div>
            ) : slackBotConfigured ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {t('slackConfigured')}
                </p>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4">
                  <h4 className="mb-2 text-sm font-medium text-[var(--color-foreground)]">
                    How to use
                  </h4>
                  <ul className="space-y-1 text-sm text-[var(--color-muted-foreground)]">
                    <li>
                      Mention the bot in any channel:{' '}
                      <code className="rounded bg-[var(--color-card)] px-1.5 py-0.5 text-xs">
                        @Wonderly how are my campaigns doing?
                      </code>
                    </li>
                    <li>It can answer questions about spend, results, CTR, and CPA.</li>
                    <li>Action buttons (pause, adjust budget) will appear inline when relevant.</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
                  <h4 className="mb-3 text-sm font-medium text-blue-900 dark:text-blue-300">
                    {t('setupInstructions')}
                  </h4>
                  <ol className="space-y-2 text-sm text-blue-800 dark:text-blue-400">
                    <li>
                      1. Create a Slack app at{' '}
                      <a
                        href="https://api.slack.com/apps"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        api.slack.com/apps
                      </a>
                    </li>
                    <li>
                      2. Go to &ldquo;Socket Mode&rdquo; and enable it, save the app-level token as{' '}
                      <code className="rounded bg-[var(--color-muted)] px-2 py-1 text-xs">
                        xapp_*.…
                      </code>
                    </li>
                    <li>3. Go to &ldquo;Event Subscriptions&rdquo; and enable events</li>
                    <li>
                      4. Set the Request URL (see below) and subscribe to{' '}
                      <code className="rounded bg-[var(--color-muted)] px-2 py-1 text-xs">
                        app_mention
                      </code>{' '}
                      events
                    </li>
                    <li>
                      5. Go to &ldquo;Interactivity&rdquo; and enable it with the Interactions URL
                      (see below)
                    </li>
                    <li>
                      6. Go to &ldquo;OAuth &amp; Permissions&rdquo; and add scopes:{' '}
                      <code className="rounded bg-[var(--color-muted)] px-2 py-1 text-xs">
                        chat:write
                      </code>
                      ,{' '}
                      <code className="rounded bg-[var(--color-muted)] px-2 py-1 text-xs">
                        app_mentions:read
                      </code>
                    </li>
                    <li>7. Install the app to your workspace and copy the Bot Token</li>
                    <li>
                      8. Set environment variables:{' '}
                      <code className="rounded bg-[var(--color-muted)] px-2 py-1 text-xs">
                        SLACK_BOT_TOKEN
                      </code>
                      ,{' '}
                      <code className="rounded bg-[var(--color-muted)] px-2 py-1 text-xs">
                        SLACK_SIGNING_SECRET
                      </code>
                    </li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-[var(--color-foreground)]">
                      {t('eventRequestUrl')}
                    </label>
                    <div className="mt-1 flex gap-2">
                      <code className="flex-1 rounded bg-[var(--color-muted)] px-3 py-2 text-sm break-all text-[var(--color-foreground)]">
                        {eventUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(eventUrl, 'event-url')}
                      >
                        {copiedUrl === 'event-url' ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-[var(--color-foreground)]">
                      {t('interactivityRequestUrl')}
                    </label>
                    <div className="mt-1 flex gap-2">
                      <code className="flex-1 rounded bg-[var(--color-muted)] px-3 py-2 text-sm break-all text-[var(--color-foreground)]">
                        {interactionUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(interactionUrl, 'interaction-url')}
                      >
                        {copiedUrl === 'interaction-url' ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Meta Account Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 p-2 dark:bg-blue-950/40">
                <MetaLogo className="h-full w-full" />
              </div>
              <div>
                <CardTitle className="text-base">{t('metaAccount')}</CardTitle>
                <CardDescription>{t('metaAccountDesc')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-muted-foreground)]">{t('metaAccountInfo')}</p>
            <form action="/api/auth/logout" method="POST" className="mt-4">
              <Button variant="destructive" size="sm" type="submit">
                {t('signOut')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
