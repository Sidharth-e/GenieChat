import { describe, expect, it } from "vitest";

/**
 * The store's *degradation* contract, which is the half of it that can be
 * tested without a server: every path here must decide something before it
 * reaches the driver.
 *
 * The store reaches `lib/config`, which loads `lib/env.ts`, which parses
 * `process.env` at first import and throws when the required key is missing.
 * Vitest does not load `.env` into `process.env`, so the key is stubbed first;
 * a real value already present is kept. The stub has to come *before* the
 * import, which is why the imports below are top-level `await import`s rather
 * than static ones — a static import is hoisted above the assignment and would
 * evaluate `lib/env.ts` too early. `indexes.test.ts` and `user-store.test.ts`
 * guard the same dependency the same way.
 *
 * `NEO4J_URI` is blanked rather than left unset for the same reason: a
 * developer running this suite locally has a real URI in `.env`, and this file
 * asserts what happens when there is none.
 */
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";
process.env.NEO4J_URI = "";

const { MemoryGraphStore } = await import("@/lib/memory/graph-store");
const { isNeo4jConfigured } = await import("@/lib/neo4j/client");

describe("MemoryGraphStore, unconfigured", () => {
  it("reports the graph as unconfigured, so the cases below are real", () => {
    expect(isNeo4jConfigured()).toBe(false);
  });

  it("refuses a capture, because a write that only appears to succeed is not", async () => {
    // Spec §8: with no `NEO4J_URI` the graph is not there. A capture is a
    // write, and the tool's "Memory saved" is a promise the node is on disk —
    // so this must fail loudly rather than return an id for nothing.
    const store = new MemoryGraphStore();

    await expect(
      store.captureSentence({
        userId: "user-1",
        userName: "Ada",
        userEmail: "ada@example.com",
        text: "Ada lives in Lisbon",
      }),
    ).rejects.toThrow(/not configured/);
  });
});
