"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  revalidateAllCache,
  shouldRevalidateAllCache,
} from "@/lib/query/cache-revalidation";

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(() => {
    let queryClientRef: QueryClient | null = null;

    const mutationCache = new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        if (!queryClientRef) return;
        if (!shouldRevalidateAllCache(mutation.options.meta)) return;

        void revalidateAllCache(queryClientRef);
      },
    });

    queryClientRef = new QueryClient({
      mutationCache,
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 1,
          staleTime: 2 * 60 * 1000,
        },
      },
    });

    return queryClientRef;
  });

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
