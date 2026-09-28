import type { KnowledgeOwnerType } from "@/constants/knowledge";

export type { KnowledgeOwnerType };

/** One retrieved chunk. Deliberately the only shape the UI and citations see. */
export interface KnowledgeHit {
  id: string;
  content: string;
  title?: string;
  sourceId?: string;
  chunkIndex: number;
  score: number;
}

export interface KnowledgeChunkInput {
  ownerType: KnowledgeOwnerType;
  ownerId: string;
  userId: string;
  sourceId?: string;
  title?: string;
  chunkIndex: number;
  content: string;
  /** null when the embedding provider was unavailable; the text is still stored and searchable lexically. */
  embedding: number[] | null;
}

export interface IndexChunksParams {
  ownerType: KnowledgeOwnerType;
  ownerId: string;
  userId: string;
  sourceId?: string;
  title?: string;
  contents: string[];
  /** Set false to store chunks without vectors (provider outage, or a lexical-only backfill). */
  embed?: boolean;
}
