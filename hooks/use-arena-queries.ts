"use client";

import { useQuery } from "@tanstack/react-query";
import type { ArenaLeaderboardEntry } from "@/lib/types";

export const arenaKeys = {
    all: ["arena"] as const,
    leaderboard: () => [...arenaKeys.all, "leaderboard"] as const,
};

/**
 * Fetches the arena leaderboard, gated on the modal being open.
 *
 * No `staleTime`: a rating only moves when a vote is cast, and the reader has
 * no way to see that from the closed modal, so the open is what makes the read
 * current.
 */
export function useArenaLeaderboard(enabled: boolean) {
    return useQuery<{ entries: ArenaLeaderboardEntry[] }>({
        queryKey: arenaKeys.leaderboard(),
        queryFn: async () => {
            const response = await fetch("/api/arena/leaderboard");
            if (!response.ok) {
                throw new Error("Failed to fetch the arena leaderboard");
            }
            return response.json();
        },
        enabled,
    });
}
