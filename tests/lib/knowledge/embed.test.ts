import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
import { EmbeddingDimensionError } from "@/lib/embeddings/dimensions";
import { embedChunkRows } from "@/lib/knowledge/embed";

/** A stand-in embedder, so the policy is testable without a provider. */
function fixedEmbedder(vector: number[] = [0.1, 0.2, 0.3]) {
  const calls: string[] = [];
  return {
    calls,
    embed: async (text: string) => {
      calls.push(text);
      return vector;
    },
  };
}

describe("embedChunkRows", () => {
  it("keeps each chunk's original index when blank chunks are dropped", async () => {
    const { rows } = await embedChunkRows(
      ["first", "   ", "", "last"],
      fixedEmbedder().embed,
    );

    expect(rows.map((row) => row.chunkIndex)).toEqual([0, 3]);
    expect(rows.map((row) => row.content)).toEqual(["first", "last"]);
  });

  it("does not call the embedder for a blank chunk", async () => {
    const embedder = fixedEmbedder();

    await embedChunkRows(["a", "  ", "b"], embedder.embed);

    expect(embedder.calls).toEqual(["a", "b"]);
  });

  it("stores a null vector for a transient failure and reports it", async () => {
    const boom = new Error("fetch failed");
    const { rows, failures } = await embedChunkRows(["a", "b"], async (text) => {
      if (text === "a") throw boom;
      return [0.1];
    });

    expect(rows[0]).toEqual({ chunkIndex: 0, content: "a", embedding: null });
    expect(rows[1].embedding).toEqual([0.1]);
    expect(failures).toEqual([{ chunkIndex: 0, error: boom }]);
  });

  it("propagates a width mismatch instead of degrading the whole index", async () => {
    const error = new EmbeddingDimensionError(
      EMBEDDING_DIMENSIONS + 256,
      EMBEDDING_DIMENSIONS,
      "generateEmbedding",
    );

    await expect(
      embedChunkRows(["a", "b"], async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("returns null vectors for every chunk when no embedder is given", async () => {
    const { rows, failures } = await embedChunkRows(["a", "b"]);

    expect(rows.map((row) => row.embedding)).toEqual([null, null]);
    expect(failures).toEqual([]);
  });

  it("returns nothing for an empty document", async () => {
    const embedder = fixedEmbedder();
    const { rows, failures } = await embedChunkRows([], embedder.embed);

    expect(rows).toEqual([]);
    expect(failures).toEqual([]);
    expect(embedder.calls).toEqual([]);
  });
});
