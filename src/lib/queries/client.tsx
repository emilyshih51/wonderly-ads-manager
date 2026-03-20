'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useSyncExternalStore } from 'react';
import type { Persister } from '@tanstack/react-query-persist-client';

const CACHE_MAX_AGE = 5 * 60_000; // 5 min

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 min — data is fresh, no refetch on mount
        gcTime: CACHE_MAX_AGE, // must be >= maxAge passed to persister
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

// useSyncExternalStore-based mount detection: false on server, true on client after hydration.
// Ensures server and first client render produce the same component tree (both start without
// the persister), eliminating the hydration mismatch from PersistQueryClientProvider.
const subscribe = () => () => {};

const getSnapshot = () => true;
const getServerSnapshot = () => false;

/** QueryClient provider scoped to dashboard pages. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const isMounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [persister] = useState<Persister>(() =>
    createSyncStoragePersister({
      storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
    })
  );

  // Render plain QueryClientProvider on server and on the first client render so both
  // produce the same HTML — avoiding React hydration mismatches.
  if (!isMounted) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE }}
    >
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  );
}
