'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 min — data is fresh, no refetch on mount
        gcTime: 5 * 60_000, // 5 min — cached data kept after unmount
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

/** QueryClient provider scoped to dashboard pages. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState ensures one QueryClient per component lifecycle (SSR-safe)
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
