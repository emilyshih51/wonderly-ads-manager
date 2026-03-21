'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'wonderly-theme';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
});

/** Drop-in replacement for `next-themes` useTheme (light/dark only). */
export const useTheme = () => useContext(ThemeContext);

/**
 * Lightweight theme provider that avoids rendering a `<script>` tag inside
 * the React component tree (which triggers a React 19 console warning).
 *
 * The FOUC-prevention script lives in layout.tsx `<head>` instead.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';

    return (localStorage.getItem(STORAGE_KEY) as Theme) || 'light';
  });

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const root = document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(next);
  }, []);

  // Apply class on mount (the <head> script handles FOUC, this syncs React state with DOM)
  useEffect(() => {
    const root = document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // Listen for changes from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setTheme(e.newValue as Theme);
      }
    };

    window.addEventListener('storage', handler);

    return () => window.removeEventListener('storage', handler);
  }, [setTheme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
