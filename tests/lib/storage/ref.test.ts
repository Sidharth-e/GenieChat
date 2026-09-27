import { describe, it, expect } from "vitest";
import {
  formatRef,
  isStorageRef,
  isStorageBucket,
  isUserScopedKey,
  keyForUser,
  parseRef,
  storageRefSchema,
} from "@/lib/storage/ref";

describe("formatRef", () => {
  it("formats a bucket and key", () => {
    expect(formatRef("chat-images", "user-1/a.png")).toBe(
      "s3://chat-images/user-1/a.png",
    );
  });

  it("strips leading slashes from the key", () => {
    expect(formatRef("reports", "/user-1/r.md")).toBe("s3://reports/user-1/r.md");
  });

  it("round-trips through parseRef", () => {
    const ref = formatRef("agent-documents", "user-1/agent-2/doc.pdf");
    expect(parseRef(ref)).toEqual({
      bucket: "agent-documents",
      key: "user-1/agent-2/doc.pdf",
    });
  });
});

describe("isStorageRef", () => {
  it("accepts an s3 ref", () => {
    expect(isStorageRef("s3://chat-images/a.png")).toBe(true);
  });

  it("rejects an https URL", () => {
    expect(isStorageRef("https://acct.blob.core.windows.net/c/b")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isStorageRef(null)).toBe(false);
    expect(isStorageRef(42)).toBe(false);
  });
});

describe("isStorageBucket", () => {
  it("accepts a known bucket", () => {
    expect(isStorageBucket("generated-images")).toBe(true);
  });

  it("rejects an unknown bucket", () => {
    expect(isStorageBucket("not-a-bucket")).toBe(false);
  });
});

describe("parseRef", () => {
  it("returns null for a non-ref", () => {
    expect(parseRef("https://example.com/a/b")).toBeNull();
  });

  it("returns null when the bucket is unknown", () => {
    expect(parseRef("s3://evil-bucket/user-1/a.png")).toBeNull();
  });

  it("returns null when the key is missing", () => {
    expect(parseRef("s3://chat-images")).toBeNull();
    expect(parseRef("s3://chat-images/")).toBeNull();
  });

  it("preserves slashes inside the key", () => {
    expect(parseRef("s3://chat-images/u/t/1-a.png")?.key).toBe("u/t/1-a.png");
  });

  it("does not percent-decode the key", () => {
    expect(parseRef("s3://chat-images/u/a%20b.png")?.key).toBe("u/a%20b.png");
  });
});

describe("keyForUser", () => {
  it("joins the user id and segments", () => {
    expect(keyForUser("u1", "thread-9", "1-a.pdf")).toBe("u1/thread-9/1-a.pdf");
  });

  it("skips empty segments", () => {
    expect(keyForUser("u1", "", "1-a.pdf")).toBe("u1/1-a.pdf");
  });

  it("returns just the user id with no segments", () => {
    expect(keyForUser("u1")).toBe("u1");
  });
});

describe("isUserScopedKey", () => {
  it("accepts a key under the user", () => {
    expect(isUserScopedKey("u1/a.png", "u1")).toBe(true);
  });

  it("rejects another user's key", () => {
    expect(isUserScopedKey("u2/a.png", "u1")).toBe(false);
  });

  it("rejects a prefix match that is not a path boundary", () => {
    expect(isUserScopedKey("u10/a.png", "u1")).toBe(false);
  });

  it("rejects a bare user id with no key", () => {
    expect(isUserScopedKey("u1", "u1")).toBe(false);
  });
});

describe("storageRefSchema", () => {
  it("accepts a valid ref", () => {
    expect(storageRefSchema.safeParse("s3://reports/u1/r.md").success).toBe(true);
  });

  it("rejects a non-ref string", () => {
    expect(storageRefSchema.safeParse("not-a-ref").success).toBe(false);
  });

  it("rejects a string over 2048 chars", () => {
    const long = `s3://reports/${"a".repeat(2100)}`;
    expect(storageRefSchema.safeParse(long).success).toBe(false);
  });
});
