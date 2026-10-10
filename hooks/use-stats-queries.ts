"use client";

import { useQuery } from "@tanstack/react-query";
import type { HomeStats } from "@/lib/types";

export const statsKeys = {
  all: ["stats"] as const,
  home: () => [...statsKeys.all, "home"] as const,
};

/**
 * The signed-in user's usage totals for the home screen.
 *
 * A shorter stale window than the thread lists: the numbers move as you chat,
 * and a token count that lags a whole session behind is worse than a refetch.
 */
export function useHomeStats() {
  return useQuery<HomeStats>({
    queryKey: statsKeys.home(),
    queryFn: async () => {
      const response = await fetch("/api/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch home stats");
      }
      return response.json();
    },
    staleTime: 1000 * 60,
  });
}
