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

  it("returns an empty result from recall instead of throwing", async () => {
    // Spec §8: "`NEO4J_URI` unset | Retrieval returns empty and logs once."
    // Retrieval is the one path that must *not* surface the store's absence as
    // an error — a chat turn with no memories is a worse answer, but it is an
    // answer, and `app/api/memories/route.ts` turns a throw into a 500 where
    // the documented behaviour is an empty list. CRUD is the opposite case and
    // is asserted separately below.
    const store = new MemoryGraphStore();

    await expect(store.searchRelevantMemories("user-1", "anything", 5)).resolves.toEqual([]);
  });

  it("still refuses CRUD, because memories are the feature", async () => {
    // The asymmetry is deliberate and is the same spec paragraph: an empty
    // list is the honest answer to "what do I remember about X" when the graph
    // is gone, but writing a memory into a store that is not there must fail
    // loudly rather than appear to succeed.
    const store = new MemoryGraphStore();

    await expect(store.getMemories("user-1")).rejects.toThrow(/not configured/);
    await expect(store.getMemory("memory-1", "user-1")).rejects.toThrow(/not configured/);
  });
});
