import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, locales, type Locale, LOCALE_COOKIE } from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value ?? defaultLocale;
  const locale: Locale = (locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default;

  return { locale, messages };
});
