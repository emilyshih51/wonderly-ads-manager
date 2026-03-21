'use server';

import { cookies } from 'next/headers';
import { fonts, type FontChoice, FONT_COOKIE } from './font-config';

/**
 * Persists the user's font preference in a cookie.
 * @param font - The font key to set.
 */
export async function setFont(font: FontChoice): Promise<void> {
  if (!(fonts as readonly string[]).includes(font)) return;
  const cookieStore = await cookies();

  cookieStore.set(FONT_COOKIE, font, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });
}
