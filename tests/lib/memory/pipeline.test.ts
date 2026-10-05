import { describe, expect, it, vi } from "vitest";
import { runRecallPipeline, type RecallDriver } from "@/lib/memory/pipeline";

/**
 * The two expansion arms are told apart by the edge pattern only their own
 * statement carries — neither statement's text names an `EXPAND`. The traversal
 * walks `[:SUBJECT|OBJECT*1..2]`; the anchor takes the single fixed
 * `-[:SUBJECT]->(:User)` hop the traversal is forbidden to take.
 */
const ENTITY_ARM = "SUBJECT|OBJECT";
const ANCHOR_ARM = "-[:SUBJECT]->(:User";

/** A driver that answers each statement from a table, and records what was asked. */
function fakeDriver(answers: Record<string, unknown[]>): {
  driver: RecallDriver;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    driver: {
      async executeQuery(query: string) {
        calls.push(query);
        const key = Object.keys(answers).find((k) => query.includes(k));
        const rows = key ? answers[key] : [];
        return {
          records: rows.map((row) => ({
            get: (field: string) => (row as Record<string, unknown>)[field],
          })),
        };
      },
    },
  };
}

describe("runRecallPipeline", () => {
  it("returns an empty result for a blank query without touching the driver", async () => {
    const { driver, calls } = fakeDriver({});
    const result = await runRecallPipeline(
      { driver, embed: vi.fn() },
      "u1",
      "   ",
      5,
    );
    expect(result.facts).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("returns the seeds ranked when expansion throws", async () => {
    // The seeds came from the index and they are good matches. A traversal
    // error must not throw away the half that worked.
    const seeds = [
      {
        id: "f1",
        sourceText: "I work as a Rust developer",
        createdAt: "2026-01-01T00:00:00.000Z",
        vectorScore: 0.91,
      },
    ];
    const calls: string[] = [];
    const rows = (r: unknown[]) => ({
      records: r.map((row) => ({
        get: (f: string) => (row as Record<string, unknown>)[f],
      })),
    });
    // The two seed statements both contain `SEARCH`, so the double has to tell
    // them apart by the label they read. Returning the same row for both would
    // put one fact's id in the result twice — a state the real graph cannot
    // reach, since facts and captures are separate labels with separate ids.
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        calls.push(query);
        if (query.includes(":Capture")) return rows([]);
        if (query.includes("SEARCH")) return rows(seeds);
        // Only the traversal explodes. The anchor arm answers empty, and the
        // predecessor read answers empty, so the failure under test is the one
        // the name says it is.
        if (query.includes(ENTITY_ARM)) {
          throw new Error("expansion exploded");
        }
        return rows([]);
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "what do I do",
      5,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].text).toContain("Rust");
    expect(result.metadata.mode).toBe("vector");
  });

  it("reports mode graph once expansion contributes", async () => {
    const seeds = [
      {
        id: "f1",
        sourceText: "I like apple products",
        createdAt: "2026-01-01T00:00:00.000Z",
        vectorScore: 0.9,
      },
    ];
    const expanded = [
      {
        id: "f2",
        sourceText: "Apple makes the Mac",
        createdAt: "2026-01-02T00:00:00.000Z",
        hops: 2,
        pathWeight: 0.8,
      },
    ];
    const rows = (r: unknown[]) => ({
      records: r.map((row) => ({
        get: (f: string) => (row as Record<string, unknown>)[f],
      })),
    });
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        if (query.includes(":Capture")) return rows([]);
        if (query.includes("SEARCH")) return rows(seeds);
        // Discriminated by the traversal's own edge pattern, not by a name: the
        // statement text carries no `EXPAND`.
        if (query.includes(ENTITY_ARM)) return rows(expanded);
        return rows([]);
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "apple",
      5,
    );

    expect(result.metadata.mode).toBe("graph");
    expect(result.facts.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("reaches the user's own profile through the anchor arm", async () => {
    // The entity arm cannot connect two facts that share nothing but their
    // subject — the anchor — because expansion is forbidden to traverse it.
    // Without this arm the height never reaches the prompt and the model asks
    // the user for what it was already told.
    const seeds = [
      {
        id: "f1",
        sourceText: "I am vegetarian",
        createdAt: "2026-01-01T00:00:00.000Z",
        vectorScore: 0.9,
      },
    ];
    const anchorReached = [
      {
        id: "f2",
        sourceText: "I am 180 cm tall",
        createdAt: "2026-01-02T00:00:00.000Z",
        hops: 1,
        pathWeight: 0.5,
      },
    ];
    const rows = (r: unknown[]) => ({
      records: r.map((row) => ({
        get: (f: string) => (row as Record<string, unknown>)[f],
      })),
    });
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        if (query.includes(":Capture")) return rows([]);
        if (query.includes(ENTITY_ARM)) return rows([]); // nothing shares an entity
        if (query.includes(ANCHOR_ARM)) return rows(anchorReached);
        return rows(seeds);
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "what diet should I follow",
      5,
    );

    expect(result.facts.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
    expect(result.metadata.mode).toBe("graph");
  });

  it("keeps the entity-linked attribution when both arms reach the same fact", async () => {
    // Both arms can land on one fact. The anchor's link says only that the user
    // said both things; the entity's says the question actually matched. The
    // entity rows are merged first, and `mergeRecallCandidates` keeps the first
    // row at a given hop count — so the fact keeps the stronger attribution
    // rather than the anchor's weaker one.
    const seeds = [
      {
        id: "f1",
        sourceText: "I like apple products",
        createdAt: "2026-01-01T00:00:00.000Z",
        vectorScore: 0.9,
      },
    ];
    const rows = (r: unknown[]) => ({
      records: r.map((row) => ({
        get: (f: string) => (row as Record<string, unknown>)[f],
      })),
    });
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        if (query.includes(":Capture")) return rows([]);
        if (query.includes(ENTITY_ARM)) {
          return rows([
            {
              id: "f2",
              sourceText: "entity-linked reason",
              createdAt: "2026-01-02T00:00:00.000Z",
              hops: 1,
              pathWeight: 0.72,
            },
          ]);
        }
        if (query.includes(ANCHOR_ARM)) {
          return rows([
            {
              id: "f2",
              sourceText: "anchor-linked reason",
              createdAt: "2026-01-02T00:00:00.000Z",
              hops: 1,
              pathWeight: 0.5,
            },
          ]);
        }
        return rows(seeds);
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "apple",
      5,
    );

    expect(result.facts.find((f) => f.id === "f2")?.text).toContain("entity-linked");
  });

  it("returns nothing when every seed is below the relevance floor", async () => {
    // A vector index returns its k nearest rows however far away they are. One
    // unrelated fact in the graph must not become an answer to any question.
    // 0.51 is the index's score for an orthogonal pair — the model's "no
    // relationship at all" — so this is the row that must not come back.
    const calls: string[] = [];
    const rows = (r: unknown[]) => ({
      records: r.map((row) => ({
        get: (f: string) => (row as Record<string, unknown>)[f],
      })),
    });
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        calls.push(query);
        if (query.includes(":Capture")) return rows([]);
        if (query.includes("SEARCH")) {
          return rows([
            {
              id: "f1",
              sourceText: "I prefer dark mode",
              createdAt: "2026-01-01T00:00:00.000Z",
              vectorScore: 0.51,
            },
          ]);
        }
        return rows([]);
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "what is the capital of France",
      5,
    );

    expect(result.facts).toEqual([]);
    expect(result.metadata.seedCount).toBe(0);
    // The floor has to gate expansion, not just the final ranking: an unrelated
    // seed that is allowed to traverse reaches a whole subgraph of unrelated
    // facts that the ranker would then have no reason to drop. The anchor arm is
    // gated on the same surviving seed — without that gate an unrelated question
    // would return the user's whole profile.
    expect(calls.some((q) => q.includes(ENTITY_ARM))).toBe(false);
    expect(calls.some((q) => q.includes(ANCHOR_ARM))).toBe(false);
  });

  it("keeps a seed that reaches the floor", async () => {
    const seeds = [
      {
        id: "f1",
        sourceText: "I really like apple products",
        createdAt: "2026-01-01T00:00:00.000Z",
        vectorScore: 0.71,
      },
    ];
    const rows = (r: unknown[]) => ({
      records: r.map((row) => ({
        get: (f: string) => (row as Record<string, unknown>)[f],
      })),
    });
    // Both arms answer empty explicitly, rather than by falling through a
    // catch-all: a fake that hands the expansion arm a seed row is a state the
    // real graph cannot reach, and one the merge tolerates only by accident.
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        if (query.includes(":Capture")) return rows([]);
        if (query.includes(ENTITY_ARM) || query.includes(ANCHOR_ARM)) return rows([]);
        return rows(seeds);
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "what brands do I like",
      5,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].text).toContain("apple");
  });

  it("labels a staged sentence as a capture", async () => {
    const captures = [
      {
        id: "c1",
        text: "I just moved to Bangalore",
        createdAt: "2026-01-03T00:00:00.000Z",
        vectorScore: 0.88,
      },
    ];
    const driver: RecallDriver = {
      async executeQuery(query: string) {
        const rows = query.includes(":Capture") ? captures : [];
        return {
          records: rows.map((r) => ({
            get: (f: string) => (r as Record<string, unknown>)[f],
          })),
        };
      },
    };

    const result = await runRecallPipeline(
      { driver, embed: async () => [1, 0] },
      "u1",
      "where do I live",
      5,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].kind).toBe("capture");
  });
});
