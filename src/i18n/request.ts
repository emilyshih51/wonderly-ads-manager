import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { defaultLocale, locales, type Locale, LOCALE_COOKIE } from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value ?? defaultLocale;
  const locale: Locale = (locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : defaultLocale;

  const messages = JSON.parse(readFileSync(join(process.cwd(), `locales/${locale}.json`), 'utf-8'));

  return { locale, messages };
});
