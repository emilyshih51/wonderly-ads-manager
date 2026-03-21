export const locales = ['en', 'es', 'zh', 'zh-TW', 'ja', 'fr', 'de', 'ko', 'pt'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const LOCALE_COOKIE = 'wonderly-locale';
