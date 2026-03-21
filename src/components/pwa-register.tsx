'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for PWA capabilities.
 * Renders nothing — just runs the registration side effect.
 */
export function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Silently fail — PWA is a progressive enhancement
      });
    }
  }, []);

  return null;
}
