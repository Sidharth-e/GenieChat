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

/**
 * The `CHAT_DOCUMENT` model, moved from `lib/azure-ai-search/models.ts`. The
 * Mongo-layer shape is `ChatDocument` in `lib/mongodb/common.ts`; this one is
 * kept because the RAG services are written against it.
 */
export interface ChatDocumentModel {
  id: string;
  userId: string;
  chatThreadId: string;
  createdAt: Date;
  type: string;
  isDeleted: boolean;
  name: string;
  content?: string;
  promptTokens?: number;
  totalPages?: number;
  numberOfIndexes?: number;
  uploadTime?: number;
  agentId?: string;
}

/**
 * `content` was `DocumentSearchResponse` — Azure's fat hit wrapper. It is a
 * `KnowledgeHit` now, singular: one citation holds one hit, and the wrapper's
 * only remaining content was the fields this interface already carries.
 */
export interface ChatCitationModel {
  id: string;
  userId: string;
  chatThreadId: string;
  createdAt: Date;
  type: string;
  content: KnowledgeHit;
}
