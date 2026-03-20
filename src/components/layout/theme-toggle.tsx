'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// useSyncExternalStore-based SSR safety: returns false on server, true on client
const subscribe = () => () => {};

const getSnapshot = () => true;
const getServerSnapshot = () => false;
const useIsMounted = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/**
 * Toggle button that switches between light and dark theme.
 * Renders null until mounted to avoid hydration mismatch.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  if (!mounted) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
      className="h-9 w-9 text-[var(--color-sidebar-foreground)] hover:bg-white/10 hover:text-white"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
