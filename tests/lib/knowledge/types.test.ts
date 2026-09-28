import { describe, expect, it } from "vitest";
import {
  CHAT_CITATION_ATTRIBUTE,
  KNOWLEDGE_OWNER_TYPES,
} from "@/constants/knowledge";
import {
  decideAgentDocumentDelete,
  type ChatCitationModel,
  type KnowledgeChunkInput,
  type KnowledgeHit,
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

describe("decideAgentDocumentDelete", () => {
  it("prunes the agent's entry once the document and its chunks were cleared", () => {
    expect(decideAgentDocumentDelete("OK")).toBe("prune");
  });

  // The regression this pins: the stored object is deleted before this runs, so
  // retaining the entry leaves a file that can never be removed -- every retry
  // fails the same way. "No document row" is a state the upload path creates on
  // purpose, by attaching a file it could not parse.
  it("prunes when there was no document row to clear", () => {
    expect(decideAgentDocumentDelete("NOT_FOUND")).toBe("prune");
  });

  it("retains the entry on a real failure, so the retry can succeed", () => {
    expect(decideAgentDocumentDelete("ERROR")).toBe("retain");
  });
});
