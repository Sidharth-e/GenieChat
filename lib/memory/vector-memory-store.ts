import { logger } from "@/lib/logger";
import { generateEmbedding } from "@/lib/azure-ai-search/embeddings";
import {
  AzureAISearchInstance,
  AzureAISearchIndexClientInstance,
} from "@/lib/azure-ai-search/client";
import { MemoryStore } from "@/lib/mongodb/memory-store";
import { Memory, MemoryCategory } from "@/lib/types";
import {
  SearchIndex,
  KnownVectorSearchAlgorithmKind,
} from "@azure/search-documents";
import { config } from "@/lib/config";
import { isProviderConfigured } from "@/lib/langchain/model-factory";
import { EMBEDDING_VECTOR_DIMENSIONS } from "@/lib/memory/vector-memory-config";

const MEMORY_INDEX_NAME = config.azureSearch.memoryIndexName;
const MIN_RELEVANCE_SCORE = 0.55; // Balanced threshold to reduce false negatives on short personal facts
const GRAPH_POOL_LIMIT = 250;
const GRAPH_EDGE_THRESHOLD = 0.2;
const GRAPH_SEED_MULTIPLIER = 3;
const GRAPH_NEIGHBOR_LIMIT = 12;
const GRAPH_SECOND_HOP_LIMIT = 6;
const GRAPH_MIN_TOKEN_LENGTH = 3;
const GRAPH_MAX_CONCEPT_FEATURES = 24;
const MAX_MEMORY_QUERY_CHARS = 24_000;
const MEMORY_QUERY_SEPARATOR = "\n...\n";

const MEMORY_CATEGORIES: Set<MemoryCategory> = new Set([
  "preference",
  "fact",
  "instruction",
  "professional",
  "other",
]);

const MEMORY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "about",
  "have",
  "will",
  "just",
  "into",
  "than",
  "them",
  "they",
  "their",
  "there",
  "what",
  "when",
  "where",
  "which",
  "while",
  "been",
  "being",
  "does",
  "did",
  "dont",
  "can't",
  "cant",
  "should",
  "could",
  "would",
  "please",
  "user",
]);

export interface MemoryRetrievalMetadata {
  mode: "graph_rag" | "vector_fallback" | "cosmos_fallback";
  semanticSeedCount: number;
  lexicalSeedCount: number;
  graphExpandedCount: number;
  candidateCount: number;
}

export interface GraphRAGMemorySearchResult {
  memories: Memory[];
  metadata: MemoryRetrievalMetadata;
}

interface SemanticCandidate {
  memory: Memory;
  score: number;
}

interface GraphNode {
  memory: Memory;
  keywords: Set<string>;
  conceptVector: Map<string, number>;
  createdAtMs: number;
}

interface RankedMemory {
  memory: Memory;
  score: number;
}

interface ConceptSpace {
  conceptByMemoryId: Map<string, Map<string, number>>;
  queryConceptVector: Map<string, number>;
}

/**
 * Vector-enabled memory store that wraps MemoryStore.
 * Provides semantic search for relevant memories.
 */
export class VectorMemoryStore {
  private memoryStore: MemoryStore;
  private static indexInitialized = false;
  private static vectorConfigured: boolean | null = null;
  private static vectorDisabledLogged = false;

  constructor() {
    this.memoryStore = new MemoryStore();
  }

  private static isVectorConfigured(): boolean {
    if (VectorMemoryStore.vectorConfigured !== null) {
      return VectorMemoryStore.vectorConfigured;
    }

    const missing: string[] = [];
    if (!config.azureSearch.name) missing.push("AZURE_SEARCH_NAME");
    if (!config.azureSearch.apiKey) missing.push("AZURE_SEARCH_API_KEY");
    if (!isProviderConfigured("ollama")) {
      missing.push("OLLAMA_API_KEY (or a local OLLAMA_BASE_URL)");
    }
    if (!config.ollama.embeddingModel) {
      missing.push("OLLAMA_EMBEDDING_MODEL");
    }

    VectorMemoryStore.vectorConfigured = missing.length === 0;
    if (
      !VectorMemoryStore.vectorConfigured &&
      !VectorMemoryStore.vectorDisabledLogged
    ) {
      logger.info(
        `[VectorMemory] Vector search disabled due to missing config: ${missing.join(", ")}`,
      );
      VectorMemoryStore.vectorDisabledLogged = true;
    }
    return VectorMemoryStore.vectorConfigured;
  }

  /**
   * Initializes the index if not already done (called automatically)
   */
  private async initializeIfNeeded(): Promise<void> {
    if (!VectorMemoryStore.isVectorConfigured()) return;
    if (VectorMemoryStore.indexInitialized) return;

    try {
      await this.ensureIndexExists();
      VectorMemoryStore.indexInitialized = true;
    } catch (err) {
      logger.error(
        { err },
        "[VectorMemory] Index initialization failed, will use fallback",
      );
    }
  }

  /**
   * Ensures the memory search index exists with vector search support
   */
  async ensureIndexExists(): Promise<void> {
    const client = AzureAISearchIndexClientInstance();

    const index: SearchIndex = {
      name: MEMORY_INDEX_NAME,
      fields: [
        { name: "id", type: "Edm.String", key: true, filterable: true },
        { name: "userId", type: "Edm.String", filterable: true },
        {
          name: "content",
          type: "Edm.String",
          searchable: true,
          analyzerName: "en.lucene",
        },
        { name: "category", type: "Edm.String", filterable: true },
        { name: "createdAt", type: "Edm.String", sortable: true },
        {
          name: "contentVector",
          type: "Collection(Edm.Single)",
          searchable: true,
          vectorSearchDimensions: EMBEDDING_VECTOR_DIMENSIONS,
          vectorSearchProfileName: "memory-vector-profile",
        },
      ],
      vectorSearch: {
        algorithms: [
          {
            name: "memory-hnsw",
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
            name: "memory-vector-profile",
            algorithmConfigurationName: "memory-hnsw",
          },
        ],
      },
      corsOptions: { allowedOrigins: ["*"] },
    };

    try {
      await client.createOrUpdateIndex(index);
      logger.info(
        `[VectorMemory] Index '${MEMORY_INDEX_NAME}' created/updated.`,
      );
    } catch (err) {
      logger.error(
        { err, indexName: MEMORY_INDEX_NAME },
        `[VectorMemory] Failed to create/update index '${MEMORY_INDEX_NAME}'`,
      );
      throw err;
    }
  }

  /**
   * Create a new memory with vector embedding and index it
   */
  async createMemory(
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt" | "userName" | "userEmail"> & {
      userName?: string;
      userEmail?: string;
    },
  ): Promise<Memory> {
    // Save to the memory store first
    const savedMemory = await this.memoryStore.createMemory(memory);

    if (!VectorMemoryStore.isVectorConfigured()) {
      return savedMemory;
    }

    // Ensure index exists before attempting to index
    await this.initializeIfNeeded();

    // Generate embedding and index
    try {
      const embedding = await generateEmbedding(memory.content);

      const client = AzureAISearchInstance(MEMORY_INDEX_NAME);
      await client.uploadDocuments([
        {
          id: savedMemory.id,
          userId: savedMemory.userId,
          content: savedMemory.content,
          category: savedMemory.category || "other",
          createdAt: savedMemory.createdAt,
          contentVector: embedding,
        },
      ]);

      logger.info(`[VectorMemory] Indexed memory ${savedMemory.id}`);
    } catch (err) {
      logger.error(
        { err, memoryId: savedMemory.id },
        `[VectorMemory] Failed to index memory ${savedMemory.id}`,
      );
      // Memory is still saved in the store, just not searchable
    }

    return savedMemory;
  }

  /**
   * Search for relevant memories based on semantic similarity
   */
  async searchRelevantMemories(
    userId: string,
    query: string,
    top: number = 5,
  ): Promise<Memory[]> {
    const result = await this.searchRelevantMemoriesWithGraph(userId, query, top);
    return result.memories;
  }

  /**
   * Hybrid Graph-RAG memory retrieval:
   * 1) semantic/vector seeds
   * 2) lexical seeds
   * 3) graph expansion via related-memory edges
   */
  async searchRelevantMemoriesWithGraph(
    userId: string,
    query: string,
    top: number = 5,
  ): Promise<GraphRAGMemorySearchResult> {
    const safeTop = Math.max(top, 1);
    const normalizedQuery = this.normalizeQueryForRetrieval(query);

    try {
      const allMemories = await this.memoryStore.getMemories(userId);
      if (allMemories.length === 0) {
        return {
          memories: [],
          metadata: {
            mode: "cosmos_fallback",
            semanticSeedCount: 0,
            lexicalSeedCount: 0,
            graphExpandedCount: 0,
            candidateCount: 0,
          },
        };
      }

      const queryTokens = this.tokenize(normalizedQuery);
      const conceptSpace = this.buildConceptSpace(allMemories, normalizedQuery);
      const lexicalScores = this.scoreLexicalCandidates(allMemories, queryTokens);
      const lexicalSeeds = this.takeTopScores(
        lexicalScores,
        Math.max(safeTop * GRAPH_SEED_MULTIPLIER, safeTop),
      );
      const conceptScores = this.scoreConceptCandidates(
        allMemories,
        conceptSpace.queryConceptVector,
        conceptSpace.conceptByMemoryId,
      );
      const conceptSeeds = this.takeTopScores(
        conceptScores,
        Math.max(safeTop * GRAPH_SEED_MULTIPLIER, safeTop),
      );

      const semanticScores = await this.scoreSemanticCandidates(
        userId,
        normalizedQuery,
        Math.max(safeTop * GRAPH_SEED_MULTIPLIER, 10),
      );
      const semanticSeeds = this.takeTopScores(
        semanticScores,
        Math.max(safeTop * GRAPH_SEED_MULTIPLIER, safeTop),
      );

      const seedScores = new Map<string, number>();
      for (const [memoryId, score] of lexicalSeeds) {
        seedScores.set(memoryId, Math.max(seedScores.get(memoryId) ?? 0, score * 0.55));
      }
      for (const [memoryId, score] of conceptSeeds) {
        seedScores.set(memoryId, Math.max(seedScores.get(memoryId) ?? 0, score * 0.75));
      }
      for (const [memoryId, score] of semanticSeeds) {
        seedScores.set(memoryId, Math.max(seedScores.get(memoryId) ?? 0, score));
      }

      if (seedScores.size === 0) {
        const mode = VectorMemoryStore.isVectorConfigured()
          ? "vector_fallback"
          : "cosmos_fallback";
        return {
          memories: allMemories.slice(0, safeTop),
          metadata: {
            mode,
            semanticSeedCount: 0,
            lexicalSeedCount: 0,
            graphExpandedCount: 0,
            candidateCount: Math.min(allMemories.length, safeTop),
          },
        };
      }

      const graphNodes = this.buildGraphPool(
        allMemories,
        seedScores,
        conceptSpace.conceptByMemoryId,
      );
      const graphScores = this.expandViaGraph(
        graphNodes,
        seedScores,
        queryTokens,
        conceptSpace.queryConceptVector,
      );

      const ranked = this.rankHybridCandidates(
        graphNodes,
        seedScores,
        semanticScores,
        lexicalScores,
        conceptScores,
        graphScores,
        conceptSpace.queryConceptVector,
        safeTop,
      );

      const memories = ranked.length > 0
        ? ranked.map((entry) => entry.memory).slice(0, safeTop)
        : allMemories.slice(0, safeTop);

      logger.info(
        `[VectorMemory] Graph-RAG retrieved ${memories.length} memory item(s): semanticSeeds=${semanticSeeds.length}, lexicalSeeds=${lexicalSeeds.length}, conceptSeeds=${conceptSeeds.length}, expanded=${graphScores.size}`,
      );

      return {
        memories,
        metadata: {
          mode: "graph_rag",
          semanticSeedCount: semanticSeeds.length,
          lexicalSeedCount: lexicalSeeds.length,
          graphExpandedCount: graphScores.size,
          candidateCount: ranked.length,
        },
      };
    } catch (err) {
      logger.error({ err }, "[VectorMemory] Graph-RAG search failed");
      const allMemories = await this.memoryStore.getMemories(userId);
      return {
        memories: allMemories.slice(0, safeTop),
        metadata: {
          mode: "cosmos_fallback",
          semanticSeedCount: 0,
          lexicalSeedCount: 0,
          graphExpandedCount: 0,
          candidateCount: Math.min(allMemories.length, safeTop),
        },
      };
    }
  }

  /**
   * Get all memories (passthrough to the memory store)
   */
  async getMemories(userId: string): Promise<Memory[]> {
    return this.memoryStore.getMemories(userId);
  }

  /**
   * Get a single memory by ID (passthrough to the memory store)
   */
  async getMemory(memoryId: string): Promise<Memory | null> {
    return this.memoryStore.getMemory(memoryId);
  }

  /**
   * Update a memory (passthrough to the memory store, re-index to search)
   */
  async updateMemory(
    memoryId: string,
    updates: Partial<Memory>,
  ): Promise<Memory | null> {
    const updated = await this.memoryStore.updateMemory(memoryId, updates);

    // Re-index if searchable/indexed fields changed
    if (
      updated &&
      (updates.content !== undefined || updates.category !== undefined)
    ) {
      if (!VectorMemoryStore.isVectorConfigured()) {
        return updated;
      }

      try {
        await this.initializeIfNeeded();
        const embedding = await generateEmbedding(updated.content);
        const client = AzureAISearchInstance(MEMORY_INDEX_NAME);
        await client.mergeOrUploadDocuments([
          {
            id: updated.id,
            userId: updated.userId,
            content: updated.content,
            category: updated.category || "other",
            createdAt: updated.createdAt,
            contentVector: embedding,
          },
        ]);
        logger.info(`[VectorMemory] Re-indexed memory ${updated.id}`);
      } catch (err) {
        logger.error(
          { err, memoryId: updated.id },
          `[VectorMemory] Failed to re-index memory ${updated.id}`,
        );
      }
    }

    return updated;
  }

  /**
   * Delete memory from both stores
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    // Delete from the store
    const deleted = await this.memoryStore.deleteMemory(memoryId);

    if (!VectorMemoryStore.isVectorConfigured()) {
      return deleted;
    }

    // Delete from search index
    try {
      const client = AzureAISearchInstance(MEMORY_INDEX_NAME);
      await client.deleteDocuments([{ id: memoryId }]);
      logger.info(`[VectorMemory] Deleted memory ${memoryId} from index`);
    } catch (err) {
      logger.error(
        { err, memoryId },
        `[VectorMemory] Failed to delete memory ${memoryId} from index`,
      );
    }

    return deleted;
  }

  private tokenize(text: string): Set<string> {
    return new Set(this.tokenizeToArray(text));
  }

  private normalizeQueryForRetrieval(query: string): string {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.length <= MAX_MEMORY_QUERY_CHARS) {
      return normalized;
    }

    const headBudget = Math.floor(
      (MAX_MEMORY_QUERY_CHARS - MEMORY_QUERY_SEPARATOR.length) * 0.3,
    );
    const tailBudget =
      MAX_MEMORY_QUERY_CHARS - MEMORY_QUERY_SEPARATOR.length - headBudget;
    const trimmed = `${normalized.slice(0, headBudget)}${MEMORY_QUERY_SEPARATOR}${normalized.slice(-tailBudget)}`;

    logger.warn(
      `[VectorMemory] Memory retrieval query truncated from ${normalized.length} to ${trimmed.length} characters`,
    );

    return trimmed;
  }

  private tokenizeToArray(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((token) => {
        if (!token) return false;
        if (token.length < GRAPH_MIN_TOKEN_LENGTH) return false;
        if (MEMORY_STOPWORDS.has(token)) return false;
        return true;
      });
  }

  private lexicalSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;

    let overlap = 0;
    for (const token of a) {
      if (b.has(token)) {
        overlap++;
      }
    }

    if (overlap === 0) return 0;
    return overlap / Math.sqrt(a.size * b.size);
  }

  private takeTopScores(
    scoreMap: Map<string, number>,
    limit: number,
  ): Array<[string, number]> {
    return Array.from(scoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  private buildGraphPool(
    allMemories: Memory[],
    seedScores: Map<string, number>,
    conceptByMemoryId: Map<string, Map<string, number>>,
  ): GraphNode[] {
    const byId = new Map(allMemories.map((memory) => [memory.id, memory]));
    const selected = new Map<string, Memory>();

    for (const memoryId of seedScores.keys()) {
      const memory = byId.get(memoryId);
      if (memory) {
        selected.set(memoryId, memory);
      }
    }

    for (const memory of allMemories) {
      if (selected.size >= GRAPH_POOL_LIMIT) break;
      selected.set(memory.id, memory);
    }

    return Array.from(selected.values()).map((memory) => ({
      memory,
      keywords: this.tokenize(memory.content),
      conceptVector: conceptByMemoryId.get(memory.id) ?? new Map<string, number>(),
      createdAtMs: Date.parse(memory.createdAt),
    }));
  }

  private relationScore(a: GraphNode, b: GraphNode): number {
    const lexical = this.lexicalSimilarity(a.keywords, b.keywords);
    const conceptSimilarity = this.conceptSimilarity(
      a.conceptVector,
      b.conceptVector,
    );

    const hasSameCategory =
      a.memory.category &&
      b.memory.category &&
      a.memory.category === b.memory.category;

    if (lexical === 0 && conceptSimilarity === 0 && !hasSameCategory) return 0;

    let score = lexical;
    score += conceptSimilarity * 0.34;

    if (hasSameCategory) {
      score += 0.12;
    }

    if (Number.isFinite(a.createdAtMs) && Number.isFinite(b.createdAtMs)) {
      const diffInDays =
        Math.abs(a.createdAtMs - b.createdAtMs) / (1000 * 60 * 60 * 24);
      if (diffInDays <= 14) {
        score += 0.06;
      } else if (diffInDays <= 60) {
        score += 0.03;
      }
    }

    return Math.min(score, 1);
  }

  private expandViaGraph(
    nodes: GraphNode[],
    seedScores: Map<string, number>,
    queryTokens: Set<string>,
    queryConceptVector: Map<string, number>,
  ): Map<string, number> {
    const nodeById = new Map(nodes.map((node) => [node.memory.id, node]));
    const adjacency = new Map<string, Array<{ neighborId: string; weight: number }>>();

    for (const node of nodes) {
      adjacency.set(node.memory.id, []);
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const weight = this.relationScore(nodes[i], nodes[j]);
        if (weight < GRAPH_EDGE_THRESHOLD) continue;

        adjacency.get(nodes[i].memory.id)?.push({
          neighborId: nodes[j].memory.id,
          weight,
        });
        adjacency.get(nodes[j].memory.id)?.push({
          neighborId: nodes[i].memory.id,
          weight,
        });
      }
    }

    for (const edges of adjacency.values()) {
      edges.sort((a, b) => b.weight - a.weight);
      if (edges.length > GRAPH_NEIGHBOR_LIMIT) {
        edges.length = GRAPH_NEIGHBOR_LIMIT;
      }
    }

    const graphScores = new Map<string, number>();

    for (const [seedId, seedScore] of seedScores.entries()) {
      const firstHopNeighbors = adjacency.get(seedId) ?? [];

      for (const firstHop of firstHopNeighbors) {
        const firstHopNode = nodeById.get(firstHop.neighborId);
        const firstHopQueryAlignment = firstHopNode
          ? this.lexicalSimilarity(queryTokens, firstHopNode.keywords)
          : 0;
        const firstHopConceptAlignment = firstHopNode
          ? this.conceptSimilarity(queryConceptVector, firstHopNode.conceptVector)
          : 0;

        const firstHopScore =
          seedScore * 0.45 +
          firstHop.weight * 0.25 +
          firstHopQueryAlignment * 0.1 +
          firstHopConceptAlignment * 0.2;

        graphScores.set(
          firstHop.neighborId,
          Math.max(graphScores.get(firstHop.neighborId) ?? 0, firstHopScore),
        );

        const secondHopNeighbors =
          (adjacency.get(firstHop.neighborId) ?? []).slice(0, GRAPH_SECOND_HOP_LIMIT);

        for (const secondHop of secondHopNeighbors) {
          if (secondHop.neighborId === seedId) continue;
          const secondHopNode = nodeById.get(secondHop.neighborId);
          const secondHopQueryAlignment = secondHopNode
            ? this.lexicalSimilarity(queryTokens, secondHopNode.keywords)
            : 0;
          const secondHopConceptAlignment = secondHopNode
            ? this.conceptSimilarity(queryConceptVector, secondHopNode.conceptVector)
            : 0;

          const secondHopScore =
            seedScore * 0.3 +
            firstHop.weight * 0.2 +
            secondHop.weight * 0.2 +
            secondHopQueryAlignment * 0.1 +
            secondHopConceptAlignment * 0.2;

          graphScores.set(
            secondHop.neighborId,
            Math.max(
              graphScores.get(secondHop.neighborId) ?? 0,
              secondHopScore,
            ),
          );
        }
      }
    }

    return graphScores;
  }

  private rankHybridCandidates(
    nodes: GraphNode[],
    seedScores: Map<string, number>,
    semanticScores: Map<string, number>,
    lexicalScores: Map<string, number>,
    conceptScores: Map<string, number>,
    graphScores: Map<string, number>,
    queryConceptVector: Map<string, number>,
    top: number,
  ): RankedMemory[] {
    const nodeById = new Map(nodes.map((node) => [node.memory.id, node]));
    const candidateIds = new Set<string>();

    for (const memoryId of seedScores.keys()) candidateIds.add(memoryId);
    for (const memoryId of graphScores.keys()) candidateIds.add(memoryId);
    for (const [memoryId] of this.takeTopScores(lexicalScores, top * GRAPH_SEED_MULTIPLIER)) {
      candidateIds.add(memoryId);
    }
    for (const [memoryId] of this.takeTopScores(conceptScores, top * GRAPH_SEED_MULTIPLIER)) {
      candidateIds.add(memoryId);
    }

    const ranked: RankedMemory[] = [];

    for (const memoryId of candidateIds) {
      const node = nodeById.get(memoryId);
      if (!node) continue;

      const semantic = semanticScores.get(memoryId) ?? 0;
      const lexical = lexicalScores.get(memoryId) ?? 0;
      const concept = conceptScores.get(memoryId) ?? 0;
      const graph = graphScores.get(memoryId) ?? 0;
      const seed = seedScores.get(memoryId) ?? 0;
      const conceptAlignment = this.conceptSimilarity(
        queryConceptVector,
        node.conceptVector,
      );

      const hybridScore = Math.max(
        seed,
        semantic * 0.45 +
          lexical * 0.15 +
          concept * 0.2 +
          graph * 0.1 +
          conceptAlignment * 0.1,
      );

      ranked.push({
        memory: node.memory,
        score: hybridScore,
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  private scoreLexicalCandidates(
    memories: Memory[],
    queryTokens: Set<string>,
  ): Map<string, number> {
    const scores = new Map<string, number>();
    if (queryTokens.size === 0) return scores;

    for (const memory of memories) {
      const memoryTokens = this.tokenize(memory.content);
      const score = this.lexicalSimilarity(queryTokens, memoryTokens);
      if (score > 0) {
        scores.set(memory.id, Math.min(score, 1));
      }
    }

    return scores;
  }

  private extractFeatures(tokens: string[]): string[] {
    const features: string[] = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      features.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return features;
  }

  private buildConceptSpace(memories: Memory[], query: string): ConceptSpace {
    const featuresByMemoryId = new Map<string, string[]>();
    const featureDocumentFrequency = new Map<string, number>();
    const memoryFeatureSets: Set<string>[] = [];

    for (const memory of memories) {
      const tokens = this.tokenizeToArray(memory.content);
      const features = this.extractFeatures(tokens);
      const featureSet = new Set(features);
      featuresByMemoryId.set(memory.id, features);
      memoryFeatureSets.push(featureSet);

      for (const feature of featureSet) {
        featureDocumentFrequency.set(
          feature,
          (featureDocumentFrequency.get(feature) ?? 0) + 1,
        );
      }
    }

    const totalDocs = Math.max(memoryFeatureSets.length, 1);
    const idfByFeature = new Map<string, number>();
    for (const [feature, df] of featureDocumentFrequency.entries()) {
      const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
      idfByFeature.set(feature, idf);
    }

    const defaultIdf = Math.log((totalDocs + 1) / 1) + 1;
    const conceptByMemoryId = new Map<string, Map<string, number>>();
    for (const memory of memories) {
      const features = featuresByMemoryId.get(memory.id) ?? [];
      conceptByMemoryId.set(
        memory.id,
        this.buildConceptVector(features, idfByFeature, defaultIdf),
      );
    }

    const queryFeatures = this.extractFeatures(this.tokenizeToArray(query));
    const queryConceptVector = this.buildConceptVector(
      queryFeatures,
      idfByFeature,
      defaultIdf,
    );

    return {
      conceptByMemoryId,
      queryConceptVector,
    };
  }

  private buildConceptVector(
    features: string[],
    idfByFeature: Map<string, number>,
    defaultIdf: number,
  ): Map<string, number> {
    if (features.length === 0) {
      return new Map<string, number>();
    }

    const tf = new Map<string, number>();
    for (const feature of features) {
      tf.set(feature, (tf.get(feature) ?? 0) + 1);
    }

    const weighted = Array.from(tf.entries()).map(([feature, count]) => {
      const idf = idfByFeature.get(feature) ?? defaultIdf;
      const tfWeight = 1 + Math.log(count);
      return [feature, tfWeight * idf] as const;
    });

    weighted.sort((a, b) => b[1] - a[1]);
    const trimmed = weighted.slice(0, GRAPH_MAX_CONCEPT_FEATURES);

    const norm = Math.sqrt(
      trimmed.reduce((sum, [, weight]) => sum + weight * weight, 0),
    );
    if (!Number.isFinite(norm) || norm === 0) {
      return new Map<string, number>();
    }

    const vector = new Map<string, number>();
    for (const [feature, weight] of trimmed) {
      vector.set(feature, weight / norm);
    }

    return vector;
  }

  private conceptSimilarity(
    a: Map<string, number>,
    b: Map<string, number>,
  ): number {
    if (a.size === 0 || b.size === 0) {
      return 0;
    }

    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [feature, weight] of smaller.entries()) {
      dot += weight * (larger.get(feature) ?? 0);
    }

    return Math.max(0, Math.min(1, dot));
  }

  private scoreConceptCandidates(
    memories: Memory[],
    queryConceptVector: Map<string, number>,
    conceptByMemoryId: Map<string, Map<string, number>>,
  ): Map<string, number> {
    const scores = new Map<string, number>();
    if (queryConceptVector.size === 0) {
      return scores;
    }

    for (const memory of memories) {
      const memoryConceptVector = conceptByMemoryId.get(memory.id);
      if (!memoryConceptVector) continue;

      const score = this.conceptSimilarity(queryConceptVector, memoryConceptVector);
      if (score > 0) {
        scores.set(memory.id, score);
      }
    }

    return scores;
  }

  private async scoreSemanticCandidates(
    userId: string,
    query: string,
    top: number,
  ): Promise<Map<string, number>> {
    const scores = new Map<string, number>();

    if (!VectorMemoryStore.isVectorConfigured()) {
      return scores;
    }

    await this.initializeIfNeeded();

    try {
      const queryVector = await generateEmbedding(query);
      const escapedUserId = userId.replace(/'/g, "''");

      const client = AzureAISearchInstance(MEMORY_INDEX_NAME);
      const searchResults = await client.search(undefined, {
        filter: `userId eq '${escapedUserId}'`,
        top,
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
      });

      const semanticCandidates: SemanticCandidate[] = [];

      for await (const result of searchResults.results) {
        if (typeof result.score !== "number" || result.score < MIN_RELEVANCE_SCORE) {
          continue;
        }

        const parsed = this.parseMemorySearchDocument(
          result.document as Record<string, unknown>,
        );
        if (!parsed) continue;

        semanticCandidates.push({
          memory: parsed,
          score: result.score,
        });
      }

      const maxScore = semanticCandidates.reduce(
        (max, current) => Math.max(max, current.score),
        0,
      );

      for (const candidate of semanticCandidates) {
        const normalized = maxScore > 0 ? candidate.score / maxScore : 0;
        scores.set(candidate.memory.id, normalized);
      }

      return scores;
    } catch (err) {
      logger.error({ err }, "[VectorMemory] Semantic seed search failed");
      return scores;
    }
  }

  private parseMemorySearchDocument(
    document: Record<string, unknown>,
  ): Memory | null {
    const id = typeof document.id === "string" ? document.id : null;
    const userId = typeof document.userId === "string" ? document.userId : null;
    const userName =
      typeof document.userName === "string" ? document.userName : "";
    const userEmail =
      typeof document.userEmail === "string" ? document.userEmail : "";
    const content =
      typeof document.content === "string" ? document.content : null;
    const createdAt =
      typeof document.createdAt === "string"
        ? document.createdAt
        : new Date().toISOString();

    if (!id || !userId || !content) {
      return null;
    }

    const rawCategory = document.category;
    const category =
      typeof rawCategory === "string" &&
      MEMORY_CATEGORIES.has(rawCategory as MemoryCategory)
        ? (rawCategory as MemoryCategory)
        : undefined;

    return {
      id,
      userId,
      userName,
      userEmail,
      content,
      category,
      createdAt,
      updatedAt: createdAt,
    };
  }
}
