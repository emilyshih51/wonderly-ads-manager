export const FONT_COOKIE = 'wonderly-font';

export const fonts = ['noto-sans', 'inter', 'jetbrains-mono'] as const;
export type FontChoice = (typeof fonts)[number];
export const defaultFont: FontChoice = 'noto-sans';
