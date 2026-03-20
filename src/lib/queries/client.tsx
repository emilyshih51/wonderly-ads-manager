'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

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

/** QueryClient provider scoped to dashboard pages. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [persister] = useState(() => {
    if (typeof window === 'undefined') return null;

    return createSyncStoragePersister({ storage: window.sessionStorage });
  });

  // SSR: persister is unavailable — wrap with plain QueryClientProvider so hooks work
  if (!persister) {
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
