'use server';

import { cookies } from 'next/headers';
import { locales, type Locale, LOCALE_COOKIE } from './config';

/**
 * Sets the user's locale preference in a cookie.
 * @param locale - The locale to set.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!(locales as readonly string[]).includes(locale)) return;
  const cookieStore = await cookies();

  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false, // must be readable by JS for the switcher UI
  });
}
