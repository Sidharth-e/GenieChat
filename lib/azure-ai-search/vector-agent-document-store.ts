import { logger } from "@/lib/logger";
import {
  SearchIndex,
  KnownVectorSearchAlgorithmKind,
  SearchOptions,
} from "@azure/search-documents";
import {
  AzureAISearchIndexClientInstance,
  AzureAISearchInstance,
} from "./client";
import { generateEmbedding, generateEmbeddings } from "./embeddings";
import { config } from "@/lib/config";
import { EMBEDDING_VECTOR_DIMENSIONS } from "@/lib/memory/vector-memory-config";

const AGENT_DOCUMENTS_INDEX_NAME = config.azureSearch.agentDocumentsIndexName;

/**
 * Document structure for agent knowledge base indexing.
 */
export interface AgentDocument {
  id: string;
  content: string;
  title: string;
  filepath: string;
  chatThreadId: string;
  userId: string;
  agentId: string;
  chunk: string;
  contentVector?: number[];
}

/**
 * Search result from vector search.
 */
export interface SearchResult {
  score: number;
  document: AgentDocument;
}

/**
 * Vector-enabled store for agent knowledge documents.
 * Handles embedding generation and vector search for agent documents.
 */
export class VectorAgentDocumentStore {
  private static indexInitialized = false;

  /**
   * Initializes the index if not already done (called automatically)
   */
  private async initializeIfNeeded(): Promise<void> {
    if (VectorAgentDocumentStore.indexInitialized) return;

    try {
      await this.ensureIndexExists();
      VectorAgentDocumentStore.indexInitialized = true;
    } catch {
      logger.error(`[VectorAgentDocument] Index initialization failed`);
    }
  }

  /**
   * Ensures the agent documents search index exists with vector search support.
   */
  async ensureIndexExists(): Promise<{
    status: string;
    errors?: { message: string }[];
  }> {
    const client = AzureAISearchIndexClientInstance();

    const index: SearchIndex = {
      name: AGENT_DOCUMENTS_INDEX_NAME,
      fields: [
        { name: "id", type: "Edm.String", key: true, filterable: true },
        {
          name: "content",
          type: "Edm.String",
          searchable: true,
          analyzerName: "en.lucene",
        },
        {
          name: "title",
          type: "Edm.String",
          searchable: true,
          filterable: true,
        },
        { name: "filepath", type: "Edm.String", filterable: true },
        { name: "chatThreadId", type: "Edm.String", filterable: true },
        { name: "userId", type: "Edm.String", filterable: true },
        { name: "agentId", type: "Edm.String", filterable: true },
        { name: "chunk", type: "Edm.String", searchable: true },
        {
          name: "contentVector",
          type: "Collection(Edm.Single)",
          searchable: true,
          vectorSearchDimensions: EMBEDDING_VECTOR_DIMENSIONS,
          vectorSearchProfileName: "agent-vector-profile",
        },
      ],
      vectorSearch: {
        algorithms: [
          {
            name: "agent-hnsw",
            kind: KnownVectorSearchAlgorithmKind.Hnsw,
            parameters: {
              m: 4,
              efConstruction: 400,
              efSearch: 500,
              metric: "cosine",
            },
          },
        ],
        profiles: [
          {
            name: "agent-vector-profile",
            algorithmConfigurationName: "agent-hnsw",
          },
        ],
      },
      corsOptions: { allowedOrigins: ["*"] },
    };

    try {
      await client.createOrUpdateIndex(index);
      logger.info(
        `[VectorAgentDocument] Index '${AGENT_DOCUMENTS_INDEX_NAME}' created/updated.`,
      );
      return { status: "OK" };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(
        `[VectorAgentDocument] Failed to create/update index: ${message}`,
      );
      return { status: "ERROR", errors: [{ message }] };
    }
  }

  /**
   * Index documents with vector embeddings.
   */
  async indexDocuments(
    documents: Omit<AgentDocument, "contentVector">[],
  ): Promise<{
    status: string;
    succeeded?: number;
    failed?: number;
    errors?: { message: string }[];
  }> {
    await this.initializeIfNeeded();
    const client = AzureAISearchInstance(AGENT_DOCUMENTS_INDEX_NAME);

    try {
      if (!documents || documents.length === 0) {
        logger.warn(
          "[VectorAgentDocument] indexDocuments called with no documents",
        );
        return { status: "OK", succeeded: 0, failed: 0 };
      }

      logger.info(
        `[VectorAgentDocument] Generating embeddings for ${documents.length} documents...`,
      );
      const texts = documents.map((d) => d.content || d.chunk || "");
      const embeddings = await generateEmbeddings(texts);

      logger.info(
        `[VectorAgentDocument] Generated ${embeddings.length} embeddings`,
      );

      const docsWithVectors: AgentDocument[] = documents.map((doc, i) => ({
        ...doc,
        contentVector: embeddings[i],
      }));

      logger.info(
        `[VectorAgentDocument] Uploading ${docsWithVectors.length} documents...`,
      );
      const uploadResult = await client.uploadDocuments(docsWithVectors);

      const succeeded = uploadResult.results.filter((r) => r.succeeded).length;
      const failed = uploadResult.results.filter((r) => !r.succeeded);

      if (failed.length > 0) {
        logger.error(
          "[VectorAgentDocument] Failed documents:",
          failed.map((f) => ({
            key: f.key,
            status: f.statusCode,
            message: f.errorMessage,
          })),
        );

        if (succeeded === 0) {
          return {
            status: "ERROR",
            errors: failed.map((f) => ({
              message: f.errorMessage || "Unknown error",
            })),
            succeeded: 0,
            failed: failed.length,
          };
        }
      }

      logger.info(
        `[VectorAgentDocument] Successfully indexed ${succeeded} documents.`,
      );
      return { status: "OK", succeeded, failed: failed.length };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`[VectorAgentDocument] Failed to index documents:`, e);
      return { status: "ERROR", errors: [{ message }] };
    }
  }

  /**
   * Search documents using hybrid (vector + keyword) search.
   */
  async searchDocuments(
    query: string,
    filter?: string,
    top: number = 5,
  ): Promise<{
    status: string;
    response?: SearchResult[];
    errors?: { message: string }[];
  }> {
    await this.initializeIfNeeded();
    const client = AzureAISearchInstance<AgentDocument>(
      AGENT_DOCUMENTS_INDEX_NAME,
    );

    try {
      logger.info(
        `[VectorAgentDocument] Performing hybrid search for: "${query}"`,
      );
      const queryVector = await generateEmbedding(query);

      const searchOptions: SearchOptions<AgentDocument> = {
        filter: filter,
        top: top,
        vectorSearchOptions: {
          queries: [
            {
              kind: "vector",
              vector: queryVector,
              kNearestNeighborsCount: top,
              fields: ["contentVector"],
            },
          ],
        },
      };

      const searchResults = await client.search(query, searchOptions);
      const results: SearchResult[] = [];

      for await (const result of searchResults.results) {
        results.push({
          score: result.score || 0,
          document: result.document as AgentDocument,
        });
      }

      logger.info(
        `[VectorAgentDocument] Hybrid search returned ${results.length} results.`,
      );
      return { status: "OK", response: results };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        message?.includes("Could not find a property named 'agentId'") ||
        message?.includes("Could not find a property named 'contentVector'")
      ) {
        logger.info(
          "[VectorAgentDocument] Schema mismatch detected. Updating index...",
        );
        try {
          await this.ensureIndexExists();
          const fallbackResults = await client.search(query, { filter, top });
          const results: SearchResult[] = [];
          for await (const result of fallbackResults.results) {
            results.push({
              score: result.score || 0,
              document: result.document as AgentDocument,
            });
          }
          return { status: "OK", response: results };
        } catch (retryError: unknown) {
          const retryMessage =
            retryError instanceof Error
              ? retryError.message
              : String(retryError);
          return { status: "ERROR", errors: [{ message: retryMessage }] };
        }
      }

      return { status: "ERROR", errors: [{ message }] };
    }
  }

  /**
   * Delete documents from the index by IDs.
   */
  async deleteDocuments(
    documentIds: string[],
  ): Promise<{ status: string; errors?: { message: string }[] }> {
    const client = AzureAISearchInstance(AGENT_DOCUMENTS_INDEX_NAME);

    try {
      await client.deleteDocuments(documentIds.map((id) => ({ id })));
      logger.info(
        `[VectorAgentDocument] Deleted ${documentIds.length} documents from index`,
      );
      return { status: "OK" };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`[VectorAgentDocument] Failed to delete documents:`, e);
      return { status: "ERROR", errors: [{ message }] };
    }
  }
}
