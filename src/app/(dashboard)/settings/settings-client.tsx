'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Copy,
  Check,
  LogOut,
  Globe,
  Type,
  Palette,
  ChevronRight,
  Bot,
} from 'lucide-react';
import { MetaLogo } from '@/components/ui/meta-logo';
import { useAssistantStore } from '@/stores/assistant-store';
import { useSlackStatus } from '@/lib/queries/slack/use-slack';
import { useTranslations } from 'next-intl';
import { setLocale } from '@/i18n/actions';
import { setFont } from '@/lib/font-actions';
import { locales, type Locale } from '@/i18n/config';
import { fonts, type FontChoice } from '@/lib/font-config';
import { cn } from '@/lib/utils';

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

const FONT_META: Record<FontChoice, { name: string; descKey: string; previewKey: string }> = {
  'noto-sans': {
    name: 'Noto Sans',
    descKey: 'fontRecommended',
    previewKey: 'fontPreview',
  },
  inter: { name: 'Inter', descKey: 'fontInter', previewKey: 'fontPreview' },
  'jetbrains-mono': {
    name: 'JetBrains Mono',
    descKey: 'fontJetBrainsMono',
    previewKey: 'fontPreview',
  },
  geist: { name: 'Geist', descKey: 'fontGeist', previewKey: 'fontPreview' },
  'geist-mono': {
    name: 'Geist Mono',
    descKey: 'fontGeistMono',
    previewKey: 'fontPreview',
  },
  'dm-sans': {
    name: 'DM Sans',
    descKey: 'fontDmSans',
    previewKey: 'fontPreview',
  },
  'space-grotesk': {
    name: 'Space Grotesk',
    descKey: 'fontSpaceGrotesk',
    previewKey: 'fontPreview',
  },
};

const FONT_VAR_MAP: Record<FontChoice, string> = {
  'noto-sans': '--font-noto-sans',
  inter: '--font-inter',
  'jetbrains-mono': '--font-jetbrains-mono',
  geist: '--font-geist',
  'geist-mono': '--font-geist-mono',
  'dm-sans': '--font-dm-sans',
  'space-grotesk': '--font-space-grotesk',
};

const FONT_FAMILY_MAP: Record<FontChoice, string> = {
  'noto-sans': 'var(--font-noto-sans)',
  inter: 'var(--font-inter)',
  'jetbrains-mono': 'var(--font-jetbrains-mono)',
  geist: 'var(--font-geist)',
  'geist-mono': 'var(--font-geist-mono)',
  'dm-sans': 'var(--font-dm-sans)',
  'space-grotesk': 'var(--font-space-grotesk)',
};

/** Slack 4-color hash logo */
function SlackLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-label="Slack" role="img">
      <path
        d="M8.843.074a2.29 2.29 0 0 0-2.29 2.293 2.29 2.29 0 0 0 2.29 2.293h2.29V2.367A2.29 2.29 0 0 0 8.843.074m0 6.116H2.293A2.29 2.29 0 0 0 0 8.483a2.29 2.29 0 0 0 2.293 2.293h6.55a2.29 2.29 0 0 0 2.29-2.293 2.29 2.29 0 0 0-2.29-2.293"
        fill="#36C5F0"
      />
      <path
        d="M23.926 8.483a2.29 2.29 0 0 0-2.29-2.293 2.29 2.29 0 0 0-2.29 2.293v2.293h2.29a2.29 2.29 0 0 0 2.29-2.293m-6.12 0V1.93A2.29 2.29 0 0 0 15.516-.36a2.29 2.29 0 0 0-2.29 2.29v6.553a2.29 2.29 0 0 0 2.29 2.293 2.29 2.29 0 0 0 2.29-2.293"
        fill="#2EB67D"
      />
      <path
        d="M15.517 23.926a2.29 2.29 0 0 0 2.29-2.293 2.29 2.29 0 0 0-2.29-2.293h-2.29v2.293a2.29 2.29 0 0 0 2.29 2.293m0-6.12h6.55a2.29 2.29 0 0 0 2.29-2.292 2.29 2.29 0 0 0-2.29-2.293h-6.55a2.29 2.29 0 0 0-2.29 2.293 2.29 2.29 0 0 0 2.29 2.293"
        fill="#ECB22E"
      />
      <path
        d="M.074 15.514a2.29 2.29 0 0 0 2.293 2.293 2.29 2.29 0 0 0 2.29-2.293v-2.293H2.367A2.29 2.29 0 0 0 .074 15.514m6.116 0v6.553a2.29 2.29 0 0 0 2.293 2.29 2.29 2.29 0 0 0 2.29-2.29v-6.553a2.29 2.29 0 0 0-2.29-2.293 2.29 2.29 0 0 0-2.293 2.293"
        fill="#E01E5A"
      />
    </svg>
  );
}

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
    startTransition(async () => {
      await setFont(font);
    });
  };

  // Apply font immediately when currentFont changes
  useEffect(() => {
    document.body.style.fontFamily = `var(${FONT_VAR_MAP[currentFont]})`;
  }, [currentFont]);

  return (
    <div className="px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-semibold text-[var(--color-foreground)]">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t('description')}</p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          {/* ── Left column ── */}
          <div className="space-y-6">
            {/* ── Appearance ── */}
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-[var(--color-border)] px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <Palette className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                  <CardTitle className="text-sm font-medium">{t('appearance')}</CardTitle>
                </div>
              </CardHeader>

              {/* Language */}
              <div className="border-b border-[var(--color-border)] px-5 py-4">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                  <Globe className="h-3.5 w-3.5" />
                  {t('language')}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {t('languageDesc')}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {locales.map((locale) => (
                    <button
                      key={locale}
                      onClick={() => handleLocaleChange(locale)}
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        locale === currentLocale
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                          : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-muted-foreground)]'
                      )}
                    >
                      <span>{LOCALE_NAMES[locale]}</span>
                      {locale === currentLocale && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                  <Type className="h-3.5 w-3.5" />
                  {t('font')}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {t('fontDesc')}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {fonts.map((font) => (
                    <button
                      key={font}
                      onClick={() => handleFontChange(font)}
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors',
                        font === currentFont
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                          : 'border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]'
                      )}
                    >
                      <div>
                        <p
                          className="text-sm font-medium text-[var(--color-foreground)]"
                          style={{ fontFamily: FONT_FAMILY_MAP[font] }}
                        >
                          {FONT_META[font].name}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                          {t(FONT_META[font].descKey)}
                        </p>
                        <p
                          className="mt-1 text-xs text-[var(--color-muted-foreground)]"
                          style={{ fontFamily: FONT_FAMILY_MAP[font] }}
                        >
                          {t(FONT_META[font].previewKey)}
                        </p>
                      </div>
                      {font === currentFont && (
                        <Check className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* ── Integrations ── */}
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-[var(--color-border)] px-5 py-4">
                <CardTitle className="text-sm font-medium">{t('integrations')}</CardTitle>
              </CardHeader>

              {/* Slack */}
              <div className="border-b border-[var(--color-border)] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <SlackLogo className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">
                        {t('slackBot')}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t('slackBotDesc')}
                      </p>
                    </div>
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

                {!slackLoading && (
                  <div className="mt-4">
                    {slackBotConfigured ? (
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t('slackConfigured')}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        <ol className="list-inside list-decimal space-y-1.5 text-xs text-[var(--color-muted-foreground)]">
                          <li>
                            {t('slackSetup1')}{' '}
                            <a
                              href="https://api.slack.com/apps"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--color-primary)] hover:underline"
                            >
                              api.slack.com/apps
                            </a>
                          </li>
                          <li>{t('slackSetup2')}</li>
                          <li>{t('slackSetup3')}</li>
                          <li>
                            {t('slackSetup4subscribe')}{' '}
                            <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">
                              app_mention
                            </code>{' '}
                            {t('slackSetup4events')}
                          </li>
                          <li>{t('slackSetup5')}</li>
                          <li>
                            {t('slackSetup6scopes')}{' '}
                            <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">
                              chat:write
                            </code>{' '}
                            <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[10px]">
                              app_mentions:read
                            </code>
                          </li>
                          <li>{t('slackSetup7')}</li>
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
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MetaLogo className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">
                        {t('metaAccount')}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t('metaAccountDesc')}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                </div>
                <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
                  {t('metaAccountInfo')}
                </p>
              </div>
            </Card>
          </div>

          {/* ── Right column ── */}
          <div className="space-y-6">
            {/* AI Assistant */}
            <Card className="overflow-hidden">
              <AssistantToggle />
            </Card>

            {/* ── Danger zone ── */}
            <Card className="overflow-hidden border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20">
              <CardContent className="px-5 pt-5 pb-4">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">{t('signOut')}</p>
                <p className="mt-0.5 text-xs text-red-600/60 dark:text-red-400/50">
                  {t('signOutDesc')}
                </p>
                <form action="/api/auth/logout" method="POST" className="mt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    type="submit"
                    className="h-7 w-full px-3 py-0 text-xs"
                  >
                    <LogOut className="mr-1.5 h-3 w-3" />
                    {t('signOut')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Toggle row for showing/hiding the Shiba Inu AI assistant overlay. */
function AssistantToggle() {
  const { assistantEnabled, setAssistantEnabled } = useAssistantStore();

  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
          <Bot className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--color-foreground)]">AI Assistant</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Show Winnie, the floating Shiba Inu chat assistant
          </p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={assistantEnabled}
        onClick={() => setAssistantEnabled(!assistantEnabled)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:outline-none',
          assistantEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted)]'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform',
            assistantEnabled ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>
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
        <code className="min-w-0 flex-1 truncate rounded-md bg-[var(--color-muted)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-foreground)]">
          {value}
        </code>
        <Button size="sm" variant="ghost" onClick={() => onCopy(value, id)} className="shrink-0">
          {copiedUrl === id ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
