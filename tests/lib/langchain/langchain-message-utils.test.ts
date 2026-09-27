import { describe, it, expect } from "vitest";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  extractTextFromContent,
  filterValidMessages,
  convertToLangChainMessages,
} from "@/lib/langchain/langchain-message-utils";
import type { Message } from "@/lib/types";

function makeMsg(
  role: "user" | "assistant" | "system",
  content: string,
): Message {
  return {
    id: "m1",
    threadId: "t1",
    userId: "u1",
    userName: "Test",
    userEmail: "test@example.com",
    role,
    content,
    versions: [],
    activeVersionIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("extractTextFromContent", () => {
  it("returns a plain string unchanged", () => {
    expect(extractTextFromContent("hello")).toBe("hello");
  });

  it("joins an array of strings", () => {
    expect(extractTextFromContent(["hello", " ", "world"])).toBe("hello world");
  });

  it("extracts text from array of {text} objects", () => {
    expect(extractTextFromContent([{ text: "foo" }, { text: "bar" }])).toBe("foobar");
  });

  it("handles a nested content array inside an object", () => {
    expect(extractTextFromContent([{ content: [{ text: "nested" }] }])).toBe("nested");
  });

  it("returns empty string for null", () => {
    expect(extractTextFromContent(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractTextFromContent(undefined)).toBe("");
  });

  it("returns empty string for an empty array", () => {
    expect(extractTextFromContent([])).toBe("");
  });

  it("returns text from a top-level {text} object", () => {
    expect(extractTextFromContent({ text: "direct" })).toBe("direct");
  });

  it("filters out empty parts from array", () => {
    expect(extractTextFromContent(["hello", null, "world"])).toBe("helloworld");
  });
});

describe("filterValidMessages", () => {
  it("passes through valid messages", () => {
    const msgs = [makeMsg("user", "hello"), makeMsg("assistant", "hi")];
    expect(filterValidMessages(msgs)).toHaveLength(2);
  });

  it("filters out null entries", () => {
    const msgs = [makeMsg("user", "hello"), null as unknown as Message];
    expect(filterValidMessages(msgs)).toHaveLength(1);
  });

  it("filters out messages with empty content", () => {
    const msgs = [makeMsg("user", "hello"), makeMsg("assistant", "")];
    expect(filterValidMessages(msgs)).toHaveLength(1);
  });

  it("filters out messages with missing role", () => {
    const bad = { ...makeMsg("user", "hello"), role: "" as "user" };
    expect(filterValidMessages([bad])).toHaveLength(0);
  });
});

describe("convertToLangChainMessages", () => {
  it("converts a user message to HumanMessage", () => {
    const result = convertToLangChainMessages({
      messages: [makeMsg("user", "hello")],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(HumanMessage);
    expect(result[0].content).toBe("hello");
  });

  it("converts an assistant message to AIMessage", () => {
    const result = convertToLangChainMessages({
      messages: [makeMsg("assistant", "hi there")],
    });
    expect(result[0]).toBeInstanceOf(AIMessage);
    expect(result[0].content).toBe("hi there");
  });

  it("converts a system message to SystemMessage", () => {
    const result = convertToLangChainMessages({
      messages: [makeMsg("system", "you are helpful")],
    });
    expect(result[0]).toBeInstanceOf(SystemMessage);
    expect(result[0].content).toBe("you are helpful");
  });

  it("skips messages with empty content", () => {
    const result = convertToLangChainMessages({
      messages: [makeMsg("user", ""), makeMsg("assistant", "")],
    });
    expect(result).toHaveLength(0);
  });

  it("appends image blocks only to the last user message", () => {
    const messages = [makeMsg("user", "first"), makeMsg("user", "second")];
    const images = [{ base64Data: "data:image/jpeg;base64,abc", mimeType: "image/jpeg" }];
    const result = convertToLangChainMessages({ messages, images });

    expect(result).toHaveLength(2);
    expect(typeof result[0].content).toBe("string");
    expect(result[0].content).toBe("first");
    expect(Array.isArray(result[1].content)).toBe(true);
    const blocks = result[1].content as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === "image_url")).toBe(true);
    expect(blocks.some((b) => b.type === "text")).toBe(true);
  });

  it("does not attach images when the images array is empty", () => {
    const result = convertToLangChainMessages({
      messages: [makeMsg("user", "hello")],
      images: [],
    });
    expect(typeof result[0].content).toBe("string");
  });
});
