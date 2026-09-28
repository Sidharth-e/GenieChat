import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
import {
  generateEmbedding,
  generateEmbeddings,
  EmbeddingDimensionError,
  openRouterEmbeddingClient,
} from "@/lib/embeddings";

vi.mock("@/lib/config", () => ({
  config: {
    openrouter: {
      apiKey: "test-api-key",
      embeddingModel: "nvidia/nemotron-3-embed-1b:free",
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe("generateEmbedding", () => {
  it("generates an embedding with contract dimensions", async () => {
    const mockVector = new Array(EMBEDDING_DIMENSIONS).fill(0.05);
    const postSpy = vi
      .spyOn(openRouterEmbeddingClient, "post")
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{ embedding: mockVector }],
        },
      });

    const result = await generateEmbedding("test input");
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(result).toEqual(mockVector);
    postSpy.mockRestore();
  });

  it("throws EmbeddingDimensionError if returned dimensions mismatch", async () => {
    const badVector = new Array(100).fill(0.05);
    const postSpy = vi
      .spyOn(openRouterEmbeddingClient, "post")
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{ embedding: badVector }],
        },
      });

    await expect(generateEmbedding("test input")).rejects.toBeInstanceOf(
      EmbeddingDimensionError,
    );
    postSpy.mockRestore();
  });

  it("handles batch generation with generateEmbeddings", async () => {
    const mockVector = new Array(EMBEDDING_DIMENSIONS).fill(0.05);
    const postSpy = vi
      .spyOn(openRouterEmbeddingClient, "post")
      .mockResolvedValue({
        status: 200,
        data: {
          data: [{ embedding: mockVector }],
        },
      });

    const results = await generateEmbeddings(["a", "b"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(results[1]).toHaveLength(EMBEDDING_DIMENSIONS);
    postSpy.mockRestore();
  });
});
