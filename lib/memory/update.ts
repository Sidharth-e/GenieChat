import type { Memory } from "./types";

/**
 * The only properties a caller may write through `updateMemory`. `SET m += $updates`
 * is a blind merge, so this list is what makes it safe — the store never sees a
 * key that is not in it.
 *
 * Deliberately absent: `userId` (re-owning), `id` and `createdAt` (identity),
 * `embedding` (derived from content), `enrichedAt` (owned by the sweep).
 */
const MEMORY_UPDATABLE_FIELDS = [
  "content",
  "userName",
  "userEmail",
] as const satisfies readonly (keyof Memory)[];

export function buildMemoryUpdateSet(
  updates: Partial<Memory>,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const field of MEMORY_UPDATABLE_FIELDS) {
    const value = updates[field];
    if (value === undefined) continue;
    set[field] = value;
  }
  return set;
}
