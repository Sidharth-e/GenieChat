import { QueryClient } from "@tanstack/react-query";

export const REVALIDATE_ALL_CACHE_META_KEY = "revalidateAllCache";

const REVALIDATION_DEBOUNCE_MS = 750;
let lastRevalidationAt = 0;
let pendingRevalidation: Promise<void> | null = null;

/**
 * Checks if a mutation requested global cache revalidation via mutation meta.
 */
export function shouldRevalidateAllCache(meta?: Record<string, unknown>) {
  return meta?.[REVALIDATE_ALL_CACHE_META_KEY] === true;
}

/**
 * Marks all queries stale and refetches only active stale queries.
 * - Deduplicated while in flight.
 * - Debounced for bursty mutation sequences.
 */
export function revalidateAllCache(queryClient: QueryClient) {
  const now = Date.now();

  if (pendingRevalidation) {
    return pendingRevalidation;
  }

  if (now - lastRevalidationAt < REVALIDATION_DEBOUNCE_MS) {
    return Promise.resolve();
  }

  lastRevalidationAt = now;
  pendingRevalidation = (async () => {
    await queryClient.invalidateQueries({ refetchType: "none" });
    await queryClient.refetchQueries({ type: "active", stale: true });
  })().finally(() => {
    pendingRevalidation = null;
  });

  return pendingRevalidation;
}

