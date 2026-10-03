import { describe, it, expect } from "vitest";
import {
  lastAssistantMessageId,
  buildLoadingMessage,
  hasReachedVersionLimit,
  shouldShowStandaloneLoader,
} from "@/lib/conversation";
import { MAX_MESSAGE_VERSIONS } from "@/constants/config";
import type { Message } from "@/lib/types";

function messageFactory(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    threadId: "thread-1",
    userId: "user-1",
    userName: "Test User",
    userEmail: "test@example.com",
    role: "user",
    content: "hello",
    versions: [],
    activeVersionIndex: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("lastAssistantMessageId", () => {
  it("returns null for an empty list", () => {
    expect(lastAssistantMessageId([])).toBeNull();
  });

  it("returns null when no message is an assistant message", () => {
    const messages = [
      messageFactory({ id: "u1", role: "user" }),
      messageFactory({ id: "u2", role: "user" }),
    ];
    expect(lastAssistantMessageId(messages)).toBeNull();
  });

  it("returns the last assistant id, not the first", () => {
    const messages = [
      messageFactory({ id: "a1", role: "assistant" }),
      messageFactory({ id: "u1", role: "user" }),
      messageFactory({ id: "a2", role: "assistant" }),
      messageFactory({ id: "u2", role: "user" }),
    ];
    expect(lastAssistantMessageId(messages)).toBe("a2");
  });

  it("ignores a trailing user message", () => {
    const messages = [
      messageFactory({ id: "a1", role: "assistant" }),
      messageFactory({ id: "u1", role: "user" }),
    ];
    expect(lastAssistantMessageId(messages)).toBe("a1");
  });
});

describe("buildLoadingMessage", () => {
  const input = {
    threadId: "thread-1",
    userId: "user-1",
    userName: "Test User",
    userEmail: "test@example.com",
    model: "some-model",
  };

  it("builds the empty assistant placeholder with the sentinel id", () => {
    const message = buildLoadingMessage(input);

    expect(message.id).toBe("__loading-indicator__");
    expect(message.role).toBe("assistant");
    expect(message.content).toBe("");
    expect(message.threadId).toBe("thread-1");
    expect(message.userId).toBe("user-1");
    expect(message.userName).toBe("Test User");
    expect(message.userEmail).toBe("test@example.com");
    expect(message.model).toBe("some-model");
    expect(message.versions).toEqual([]);
    expect(message.activeVersionIndex).toBe(0);
  });

  it("produces an ISO 8601 createdAt", () => {
    expect(buildLoadingMessage(input).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("shouldShowStandaloneLoader", () => {
  it("is false when not loading", () => {
    expect(
      shouldShowStandaloneLoader({
        isLoading: false,
        streamingMessageId: null,
        lastMessage: undefined,
      }),
    ).toBe(false);
  });

  it("is false when a message is already streaming", () => {
    expect(
      shouldShowStandaloneLoader({
        isLoading: true,
        streamingMessageId: "msg-1",
        lastMessage: messageFactory({ role: "assistant" }),
      }),
    ).toBe(false);
  });

  it("is true when loading with no messages at all", () => {
    expect(
      shouldShowStandaloneLoader({
        isLoading: true,
        streamingMessageId: null,
        lastMessage: undefined,
      }),
    ).toBe(true);
  });

  it("is true when loading and the last message is from the user", () => {
    expect(
      shouldShowStandaloneLoader({
        isLoading: true,
        streamingMessageId: null,
        lastMessage: messageFactory({ role: "user" }),
      }),
    ).toBe(true);
  });

  it("is false when loading and the last message is from the assistant", () => {
    expect(
      shouldShowStandaloneLoader({
        isLoading: true,
        streamingMessageId: null,
        lastMessage: messageFactory({ role: "assistant" }),
      }),
    ).toBe(false);
  });
});

describe("hasReachedVersionLimit", () => {
  it("is false below the cap", () => {
    expect(hasReachedVersionLimit(1)).toBe(false);
    expect(hasReachedVersionLimit(MAX_MESSAGE_VERSIONS - 1)).toBe(false);
  });

  it("is true at the cap", () => {
    expect(hasReachedVersionLimit(MAX_MESSAGE_VERSIONS)).toBe(true);
  });

  it("is true above the cap", () => {
    expect(hasReachedVersionLimit(MAX_MESSAGE_VERSIONS + 1)).toBe(true);
  });

  it("treats a message with no stored versions as holding one", () => {
    expect(hasReachedVersionLimit(0)).toBe(false);
  });
});
