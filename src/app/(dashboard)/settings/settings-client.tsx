'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Copy, Check, LogOut } from 'lucide-react';
import { MetaLogo } from '@/components/ui/meta-logo';
import { useSlackStatus } from '@/lib/queries/slack/use-slack';
import { useTranslations } from 'next-intl';
import { setLocale } from '@/i18n/actions';
import { setFont } from '@/lib/font-actions';
import { locales, type Locale } from '@/i18n/config';
import { fonts, type FontChoice } from '@/lib/font-config';

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

const FONT_VAR_MAP: Record<FontChoice, string> = {
  'noto-sans': '--font-noto-sans',
  inter: '--font-inter',
  'jetbrains-mono': '--font-jetbrains-mono',
};

export function SettingsClient({
  initialLocale,
  initialFont,
}: {
  initialLocale: Locale;
  initialFont: FontChoice;
}) {
  const t = useTranslations('settings');
  const { data: slackStatus, isLoading: slackLoading } = useSlackStatus();
  const slackBotConfigured = slackStatus?.configured ?? false;
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [currentLocale, setCurrentLocale] = useState(initialLocale);
  const [currentFont, setCurrentFont] = useState(initialFont);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const eventUrl = `${origin}/api/slack/events`;
  const interactionUrl = `${origin}/api/slack/interactions`;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(id);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleLocaleChange = (locale: Locale) => {
    setCurrentLocale(locale);
    startTransition(async () => {
      await setLocale(locale);
      router.refresh();
    });
  };

  const handleFontChange = (font: FontChoice) => {
    setCurrentFont(font);
    document.documentElement.style.setProperty('--font-active', `var(${FONT_VAR_MAP[font]})`);
    startTransition(async () => {
      await setFont(font);
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-xl font-semibold text-[var(--color-foreground)]">{t('title')}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t('description')}</p>

      <div className="mt-8 divide-y divide-[var(--color-border)]">
        {/* Language */}
        <div className="py-5">
          <div className="mb-1 text-sm font-medium text-[var(--color-foreground)]">
            {t('language')}
          </div>
          <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">{t('languageDesc')}</p>
          <div className="flex flex-wrap gap-2">
            {locales.map((locale) => (
              <button
                key={locale}
                onClick={() => handleLocaleChange(locale)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  locale === currentLocale
                    ? 'bg-[var(--color-foreground)] text-[var(--color-background)]'
                    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                }`}
              >
                {LOCALE_NAMES[locale]}
              </button>
            ))}
          </div>
        </div>

        {/* Font */}
        <div className="py-5">
          <div className="mb-1 text-sm font-medium text-[var(--color-foreground)]">{t('font')}</div>
          <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">{t('fontDesc')}</p>
          <div className="flex flex-wrap gap-2">
            {fonts.map((font) => (
              <button
                key={font}
                onClick={() => handleFontChange(font)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  font === currentFont
                    ? 'bg-[var(--color-foreground)] text-[var(--color-background)]'
                    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                }`}
              >
                {FONT_NAMES[font]}
              </button>
            ))}
          </div>
        </div>

        {/* Slack Bot */}
        <div className="py-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-[var(--color-foreground)]">
              {t('slackBot')}
            </div>
            {slackLoading ? (
              <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--color-muted)]" />
            ) : slackBotConfigured ? (
              <Badge variant="active">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {t('configured')}
              </Badge>
            ) : (
              <Badge variant="secondary">{t('notConfigured')}</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t('slackBotDesc')}</p>

          {!slackLoading && (
            <div className="mt-4">
              {slackBotConfigured ? (
                <div className="space-y-2 text-xs text-[var(--color-muted-foreground)]">
                  <p>
                    Mention{' '}
                    <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-[var(--color-foreground)]">
                      @ads-manager
                    </code>{' '}
                    in any Slack channel to ask about campaign performance.
                  </p>
                  <p>
                    The bot answers questions about spend, results, CTR, and CPA. Action buttons
                    appear inline for pause, resume, and budget changes.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <ol className="list-inside list-decimal space-y-1.5 text-xs text-[var(--color-muted-foreground)]">
                    <li>
                      Create a Slack app at{' '}
                      <a
                        href="https://api.slack.com/apps"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-primary)] hover:underline"
                      >
                        api.slack.com/apps
                      </a>
                    </li>
                    <li>Enable Socket Mode and save the app-level token</li>
                    <li>Enable Event Subscriptions with the URL below</li>
                    <li>
                      Subscribe to{' '}
                      <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono">
                        app_mention
                      </code>{' '}
                      events
                    </li>
                    <li>Enable Interactivity with the URL below</li>
                    <li>
                      Add OAuth scopes:{' '}
                      <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono">
                        chat:write
                      </code>{' '}
                      <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono">
                        app_mentions:read
                      </code>
                    </li>
                    <li>Install to your workspace</li>
                    <li>
                      Set{' '}
                      <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono">
                        SLACK_BOT_TOKEN
                      </code>{' '}
                      and{' '}
                      <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono">
                        SLACK_SIGNING_SECRET
                      </code>
                    </li>
                  </ol>

                  <div className="space-y-2">
                    <CopyField
                      label={t('eventRequestUrl')}
                      value={eventUrl}
                      id="event-url"
                      copiedUrl={copiedUrl}
                      onCopy={copyToClipboard}
                    />
                    <CopyField
                      label={t('interactivityRequestUrl')}
                      value={interactionUrl}
                      id="interaction-url"
                      copiedUrl={copiedUrl}
                      onCopy={copyToClipboard}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Meta Account */}
        <div className="py-5">
          <div className="flex items-center gap-2">
            <MetaLogo className="h-4 w-4" />
            <div className="text-sm font-medium text-[var(--color-foreground)]">
              {t('metaAccount')}
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            {t('metaAccountInfo')}
          </p>
        </div>

        {/* Danger Zone */}
        <div className="py-5">
          <div className="flex flex-col gap-4 rounded-lg border border-red-600/20 bg-red-600/5 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">{t('signOut')}</p>
              <p className="mt-0.5 text-xs text-red-700/60 dark:text-red-400/60">
                Disconnect your Meta account and end this session.
              </p>
            </div>
            <form action="/api/auth/logout" method="POST" className="shrink-0">
              <Button variant="destructive" size="sm" type="submit" className="w-full md:w-auto">
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                {t('signOut')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyField({
  label,
  value,
  id,
  copiedUrl,
  onCopy,
}: {
  label: string;
  value: string;
  id: string;
  copiedUrl: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--color-muted-foreground)]">{label}</label>
      <div className="flex gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-md bg-[var(--color-muted)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)]">
          {value}
        </code>
        <Button size="sm" variant="ghost" onClick={() => onCopy(value, id)} className="shrink-0">
          {copiedUrl === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
