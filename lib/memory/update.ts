import { MEMORY_CATEGORIES } from "@/constants/memory";
import type { Memory, MemoryCategory } from "./types";

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
  "category",
  "userName",
  "userEmail",
] as const satisfies readonly (keyof Memory)[];

/**
 * `category` is the one writable field whose value is constrained rather than
 * free — it is rendered inline in the prompt as `- [category] ...`, so an
 * unrecognised string is user-visible noise on every turn. This is the call site
 * that makes `MEMORY_CATEGORIES` a runtime check rather than a declaration.
 */
export function normalizeMemoryCategory(value: unknown): MemoryCategory | undefined {
  if (typeof value !== "string") return undefined;
  return MEMORY_CATEGORIES.has(value as MemoryCategory)
    ? (value as MemoryCategory)
    : undefined;
}

export function buildMemoryUpdateSet(
  updates: Partial<Memory>,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const field of MEMORY_UPDATABLE_FIELDS) {
    const value = updates[field];
    if (value === undefined) continue;
    if (field === "category") {
      const category = normalizeMemoryCategory(value);
      if (category === undefined) continue;
      set.category = category;
      continue;
    }
    set[field] = value;
  }
  return set;
}
