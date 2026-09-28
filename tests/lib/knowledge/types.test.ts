import { describe, expect, it } from "vitest";
import {
  CHAT_CITATION_ATTRIBUTE,
  KNOWLEDGE_OWNER_TYPES,
} from "@/constants/knowledge";
import type {
  ChatCitationModel,
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

  it("holds a single KnowledgeHit as a citation's content", () => {
    const citation: ChatCitationModel = {
      id: "citation-1",
      userId: "user-1",
      chatThreadId: "thread-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: CHAT_CITATION_ATTRIBUTE,
      content: {
        id: "chunk-1",
        content: "hello",
        chunkIndex: 0,
        score: 0.3,
      },
    };
    expect(citation.content.id).toBe("chunk-1");
  });
});
