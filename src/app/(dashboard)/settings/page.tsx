import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { type Locale } from '@/i18n/config';
import { fonts, type FontChoice, FONT_COOKIE, defaultFont } from '@/lib/font-config';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const locale = (await getLocale()) as Locale;
  const rawFont = cookieStore.get(FONT_COOKIE)?.value ?? defaultFont;
  const font: FontChoice = (fonts as readonly string[]).includes(rawFont)
    ? (rawFont as FontChoice)
    : defaultFont;

  return <SettingsClient initialLocale={locale} initialFont={font} />;
}
