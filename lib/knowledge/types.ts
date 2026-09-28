import type { KnowledgeOwnerType } from "@/constants/knowledge";
import type { ServerActionResponse } from "@/lib/types";

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

/**
 * What an agent's file entry should do once `DeleteChatDocument` has run for it.
 *
 * `NOT_FOUND` counts as success, and that is the whole point of this function:
 * the upload route attaches a file to the agent whether or not its text could be
 * parsed and indexed, so "listed, with no `documents` row" is a state the upload
 * path creates deliberately. The stored object is deleted *before* this runs, so
 * treating that state as a failure leaves the entry listed with nothing left to
 * clear -- every retry fails the same way and the file can never be removed.
 *
 * Only `ERROR` -- the document store or the chunk delete genuinely failing --
 * retains the entry, which is what keeps the retry meaningful.
 */
export function decideAgentDocumentDelete(
  outcome: ServerActionResponse<boolean>["status"],
): "prune" | "retain" {
  return outcome === "ERROR" ? "retain" : "prune";
}
