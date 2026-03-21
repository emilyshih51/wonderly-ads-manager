import type { Metadata } from 'next';
import {
  Inter,
  Noto_Sans,
  Noto_Sans_JP,
  Noto_Sans_SC,
  Noto_Sans_TC,
  JetBrains_Mono,
} from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { FONT_COOKIE, defaultFont, type FontChoice, fonts } from '@/lib/font-config';
import './globals.css';

/* ── Fonts ── */

// Noto Sans with CJK support — recommended default
const notoSans = Noto_Sans({
  variable: '--font-noto-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// Noto Sans Japanese
const notoSansJP = Noto_Sans_JP({
  variable: '--font-noto-sans-jp',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

// Noto Sans Simplified Chinese
const notoSansSC = Noto_Sans_SC({
  variable: '--font-noto-sans-sc',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

// Noto Sans Traditional Chinese
const notoSansTC = Noto_Sans_TC({
  variable: '--font-noto-sans-tc',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

// Inter — Latin-only alternative
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

// JetBrains Mono — monospace option
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Wonderly Ads Manager',
  description: 'Manage your Meta ads, track performance, and automate your workflow.',
  icons: { icon: '/favicon.svg' },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  const cookieStore = await cookies();
  const rawFont = cookieStore.get(FONT_COOKIE)?.value ?? defaultFont;
  const fontChoice: FontChoice = (fonts as readonly string[]).includes(rawFont)
    ? (rawFont as FontChoice)
    : defaultFont;

  // Map font choice to the correct CSS variable
  const fontVarMap: Record<FontChoice, string> = {
    'noto-sans': '--font-noto-sans',
    inter: '--font-inter',
    'jetbrains-mono': '--font-jetbrains-mono',
  };
  const activeFontVar = fontVarMap[fontChoice];

  // Always load all font variables so switching is instant with no new network request
  const fontClasses = [
    notoSans.variable,
    notoSansJP.variable,
    notoSansSC.variable,
    notoSansTC.variable,
    inter.variable,
    jetbrainsMono.variable,
    'antialiased',
  ].join(' ');

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Set --font-active before first paint so Tailwind's font-sans utility picks the right font.
            This overrides the @theme inline fallback and avoids any layout shift. */}
        <style>{`:root { --font-active: var(${activeFontVar}); }`}</style>
      </head>
      <body className={fontClasses}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          storageKey="wonderly-theme"
        >
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
