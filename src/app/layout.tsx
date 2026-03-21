import type { Metadata, Viewport } from 'next';
import {
  Inter,
  Noto_Sans,
  Noto_Sans_JP,
  Noto_Sans_SC,
  Noto_Sans_TC,
  JetBrains_Mono,
  Geist,
  Geist_Mono,
  DM_Sans,
  Space_Grotesk,
} from 'next/font/google';
import { ThemeProvider } from '@/components/providers';
import { PWARegister } from '@/components/pwa-register';
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

// Geist — modern geometric by Vercel
const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
  display: 'swap',
});

// Geist Mono — monospace companion to Geist
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

// DM Sans — friendly geometric sans-serif
const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// Space Grotesk — proportional techy feel
const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#0467DF',
};

export const metadata: Metadata = {
  title: 'Wonderly Ads Manager',
  description: 'Manage your Meta ads, track performance, and automate your workflow.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Wonderly',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
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
    geist: '--font-geist',
    'geist-mono': '--font-geist-mono',
    'dm-sans': '--font-dm-sans',
    'space-grotesk': '--font-space-grotesk',
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
    geist.variable,
    geistMono.variable,
    dmSans.variable,
    spaceGrotesk.variable,
    'antialiased',
  ].join(' ');

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={fontClasses} style={{ fontFamily: `var(${activeFontVar})` }}>
        <ThemeProvider>
          <NextIntlClientProvider key={locale} locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
        <PWARegister />
      </body>
    </html>
  );
}
