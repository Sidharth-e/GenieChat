// Width of the vectors written to Azure AI Search. Both the memory index and
// the agent-document index declare this as their `contentVector.vectorSearchDimensions`,
// so it must match the output width of OLLAMA_EMBEDDING_MODEL.
//
// 1536 matches the OpenAI text-embedding-3-large vectors already in those
// indexes. Pointing OLLAMA_EMBEDDING_MODEL at a model with a different width
// requires recreating both indexes and re-embedding existing content — vectors
// from different models are not comparable even at the same width.
export const EMBEDDING_VECTOR_DIMENSIONS = 1536;
