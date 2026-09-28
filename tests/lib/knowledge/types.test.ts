import { describe, expect, it } from "vitest";
import { KNOWLEDGE_OWNER_TYPES } from "@/constants/knowledge";
import type {
  KnowledgeChunkInput,
  KnowledgeHit,
} from "@/lib/knowledge/types";

describe("knowledge types", () => {
  it("has exactly the two owner kinds the schema allows", () => {
    expect([...KNOWLEDGE_OWNER_TYPES]).toEqual(["agent", "chat"]);
  });

  it("builds an agent chunk with every required field", () => {
    const chunk: KnowledgeChunkInput = {
      ownerType: "agent",
      ownerId: "agent-1",
      userId: "user-1",
      chunkIndex: 0,
      content: "hello",
      embedding: [0.1, 0.2],
    };
    expect(chunk.ownerType).toBe("agent");
  });

  it("builds a chat chunk that names its source document", () => {
    const chunk: KnowledgeChunkInput = {
      ownerType: "chat",
      ownerId: "thread-1",
      userId: "user-1",
      sourceId: "doc-1",
      title: "handbook.pdf",
      chunkIndex: 3,
      content: "hello",
      embedding: null,
    };
    expect(chunk.sourceId).toBe("doc-1");
  });

  it("carries the fields a citation needs from a hit", () => {
    const hit: KnowledgeHit = {
      id: "chunk-1",
      content: "hello",
      title: "handbook.pdf",
      sourceId: "doc-1",
      chunkIndex: 3,
      score: 0.5,
    };
    expect(hit.score).toBe(0.5);
  });
});
