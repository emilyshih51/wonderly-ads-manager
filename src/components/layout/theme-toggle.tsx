'use client';

import { useTheme } from '@/components/providers';
import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

const subscribe = () => () => {};

const getSnapshot = () => true;
const getServerSnapshot = () => false;
const useIsMounted = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/**
 * Toggle button that switches between light and dark theme.
 * Adds a temporary `.theme-transition` class to `<html>` so the
 * CSS transition only fires during an actual theme switch — not on
 * page load or navigation.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  const handleToggle = useCallback(() => {
    if (!mounted) return;
    document.documentElement.classList.add('theme-transition');
    setTheme(theme === 'dark' ? 'light' : 'dark');
    // Remove after transition completes
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 200);
  }, [mounted, theme, setTheme]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label="Toggle theme"
      className="h-9 w-9 text-[var(--color-sidebar-foreground)] hover:bg-white/10 hover:text-white"
    >
      {mounted ? (
        theme === 'dark' ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )
      ) : (
        <Moon className="h-4 w-4 opacity-0" />
      )}
    </Button>
  );
}
