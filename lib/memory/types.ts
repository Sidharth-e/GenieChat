/**
 * Memory types. `Memory` and `MemoryCategory` are re-exported from
 * `lib/types.ts` rather than redeclared: the API routes, the memory UI and
 * `lib/tool/memory.ts` all import them from there, and `MEMORY_CATEGORIES`
 * (constants/memory.ts) is typed against the live union. Declaring a second,
 * narrower copy here would drop `"instruction"` and `"professional"` —
 * categories the UI offers and stored memories already carry.
 */
import type { Memory } from "@/lib/types";

export type { Memory, MemoryCategory } from "@/lib/types";

/**
 * "vector" means the graph layer was unavailable and recall fell back to a
 * plain vector seed — the honest description of the degraded path.
 * "cosmos_fallback" is deleted: it named a store that no longer exists, and it
 * was reached by injecting the newest N memories regardless of relevance.
 */
export type MemoryMode = "graph" | "vector";

export interface MemoryRetrievalMetadata {
  mode: MemoryMode;
  semanticSeedCount: number;
  lexicalSeedCount: number;
  graphExpandedCount: number;
  totalCandidates: number;
}

export interface GraphRAGMemorySearchResult {
  memories: Memory[];
  metadata: MemoryRetrievalMetadata;
}
