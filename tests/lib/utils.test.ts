import { describe, it, expect } from "vitest";
import { cn, formatDate, truncateText, applyMessageVersion } from "@/lib/utils";
import type { Message } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg1",
    threadId: "thread1",
    userId: "user1",
    userName: "Test User",
    userEmail: "test@example.com",
    role: "assistant",
    content: "original content",
    versions: [],
    activeVersionIndex: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeVersion(content: string, model = "gpt-5.4") {
  return {
    versionId: "v1",
    content,
    model,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("ignores falsy values", () => {
    expect(cn("foo", false as unknown as string, undefined, "bar")).toBe("foo bar");
  });

  it("resolves Tailwind conflicts via tailwind-merge (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("returns Today for a date from earlier today", () => {
    expect(formatDate(new Date())).toBe("Today");
  });

  it("returns Yesterday for a date exactly 1 day ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    expect(formatDate(d)).toBe("Yesterday");
  });

  it("returns N days ago for dates 2-6 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    expect(formatDate(d)).toBe("3 days ago");
  });

  it("returns formatted absolute date for dates 7+ days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    const result = formatDate(d);
    expect(result).not.toMatch(/days ago|Today|Yesterday/);
    expect(result).toMatch(/[A-Z][a-z]+ \d+/);
  });

  it("includes year for dates from a different year", () => {
    const result = formatDate(new Date("2020-06-15"));
    expect(result).toContain("2020");
  });

  it("accepts a date string as input", () => {
    expect(formatDate(new Date().toISOString())).toBe("Today");
  });
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe("truncateText", () => {
  it("returns text unchanged when under the limit", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("returns text unchanged when exactly at the limit", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("truncates and appends ellipsis when over the limit", () => {
    expect(truncateText("hello world", 8)).toBe("hello...");
  });

  it("handles maxLength of 3 (only ellipsis)", () => {
    expect(truncateText("abcdef", 3)).toBe("...");
  });
});

// ---------------------------------------------------------------------------
// applyMessageVersion
// ---------------------------------------------------------------------------

describe("applyMessageVersion", () => {
  it("applies the content of a valid version index", () => {
    const msg = makeMessage({
      versions: [makeVersion("v0 content"), makeVersion("v1 content")],
      activeVersionIndex: 0,
    });
    const result = applyMessageVersion(msg, 1);
    expect(result.content).toBe("v1 content");
    expect(result.activeVersionIndex).toBe(1);
  });

  it("applies model from the version", () => {
    const msg = makeMessage({
      versions: [makeVersion("content", "claude-sonnet-4-6")],
      activeVersionIndex: 0,
    });
    const result = applyMessageVersion(msg, 0);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("returns the message unchanged for an out-of-bounds index", () => {
    const msg = makeMessage({ versions: [makeVersion("v0")], activeVersionIndex: 0 });
    expect(applyMessageVersion(msg, 5)).toBe(msg);
  });

  it("returns the message unchanged for a negative index", () => {
    const msg = makeMessage({ versions: [makeVersion("v0")], activeVersionIndex: 0 });
    expect(applyMessageVersion(msg, -1)).toBe(msg);
  });

  it("returns the message unchanged when versions array is absent", () => {
    const msg = makeMessage({ versions: undefined as unknown as [] });
    expect(applyMessageVersion(msg, 0)).toBe(msg);
  });
});
