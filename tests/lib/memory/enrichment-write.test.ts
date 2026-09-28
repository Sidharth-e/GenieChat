import { describe, expect, it } from "vitest";
import {
  writeEnrichment,
  type StatementRunner,
} from "@/lib/memory/enrichment-write";
import {
  ENTITY_ABOUT_SQL,
  ENTITY_EXACT_SQL,
  ENTITY_NEAREST_SQL,
  MEMORY_ENRICHED_AT_SQL,
  RELATION_SQL,
  buildMemoryEdgeSql,
} from "@/lib/memory/cypher";
import type { Enrichment } from "@/lib/memory/enrichment-schema";

/**
 * The runner is injected, so this covers the resolution *order* — which the
 * spec fixes and the live check cannot see — without a database. The statements
 * themselves are covered live by `scripts/check-memory.ts`.
 */
type Answers = { exact?: string[]; nearest?: string };

function recorder(answers: Answers = {}) {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const run: StatementRunner = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === ENTITY_EXACT_SQL) {
      return answers.exact?.includes(String(params.normalizedName))
        ? [{ id: "existing" }]
        : [];
    }
    if (sql === ENTITY_NEAREST_SQL) {
      return answers.nearest ? [{ normalizedName: answers.nearest }] : [];
    }
    return [];
  };
  const about = () => calls.filter((call) => call.sql === ENTITY_ABOUT_SQL);
  const of = (sql: string) => calls.filter((call) => call.sql === sql);
  return { run, calls, about, of };
}

function enrichment(overrides: Partial<Enrichment> = {}): Enrichment {
  return {
    entities: [],
    relations: [],
    memoryEdges: [],
    ...overrides,
  };
}

const acme = {
  name: "Acme",
  normalizedName: "acme",
  type: "organization",
};

describe("writeEnrichment entity resolution", () => {
  it("resolves an entity that already exists, without consulting the vector index", async () => {
    const { run, about, of } = recorder({ exact: ["acme"] });
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment({ entities: [acme] }),
      entityEmbeddings: new Map([["acme", [1, 0]]]),
    });

    expect(about()).toHaveLength(1);
    expect(about()[0].params.normalizedName).toBe("acme");
    // Step 2 is the *else* of step 1: an exact hit must not cost a search.
    expect(of(ENTITY_NEAREST_SQL)).toHaveLength(0);
  });

  it("collapses onto the nearest entity when no exact one exists", async () => {
    const { run, about, of } = recorder({ nearest: "acme" });
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment({
        entities: [{ name: "Acme Corp", normalizedName: "acme corp", type: "organization" }],
      }),
      entityEmbeddings: new Map([["acme corp", [1, 0]]]),
    });

    expect(of(ENTITY_NEAREST_SQL)).toHaveLength(1);
    expect(of(ENTITY_NEAREST_SQL)[0].params.threshold).toBe(0.9);
    expect(about()[0].params.normalizedName).toBe("acme");
  });

  it("keeps its own name when nothing is close enough", async () => {
    const { run, about } = recorder();
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment({ entities: [acme] }),
      entityEmbeddings: new Map([["acme", [1, 0]]]),
    });

    expect(about()[0].params.normalizedName).toBe("acme");
  });

  it("skips the search entirely for an entity with no embedding", async () => {
    // The provider-outage path: exact match or create, never a search on a
    // vector that does not exist.
    const { run, of, about } = recorder({ nearest: "acme" });
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment({ entities: [acme] }),
      entityEmbeddings: new Map(),
    });

    expect(of(ENTITY_NEAREST_SQL)).toHaveLength(0);
    expect(about()[0].params.normalizedName).toBe("acme");
  });

  it("rewrites relation endpoints onto the names they resolved to", async () => {
    const { run, of } = recorder({ nearest: "acme" });
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment({
        entities: [
          { name: "Acme Corp", normalizedName: "acme corp", type: "organization" },
          { name: "Bengaluru", normalizedName: "bengaluru", type: "place" },
        ],
        relations: [{ from: "acme corp", to: "bengaluru", type: "located_in" }],
      }),
      entityEmbeddings: new Map([["acme corp", [1, 0]]]),
    });

    const relations = of(RELATION_SQL)[0].params.relations as {
      from: string;
      to: string;
    }[];
    // A relation left naming the unresolved "acme corp" would match no node and
    // vanish silently.
    expect(relations[0].from).toBe("acme");
    expect(relations[0].to).toBe("bengaluru");
  });
});

describe("writeEnrichment writes", () => {
  it("stamps enrichedAt even when there was nothing to write", async () => {
    const { run, calls } = recorder();
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment(),
      entityEmbeddings: new Map(),
    });

    // "asked and there was nothing" must not read as "never asked", or the
    // sweep pays a model call for this memory forever.
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe(MEMORY_ENRICHED_AT_SQL);
  });

  it("writes one statement per edge type present, skipping the absent ones", async () => {
    const { run, of } = recorder();
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment({
        memoryEdges: [
          { targetId: "m2", type: "CONTRADICTS", reason: "different day" },
          { targetId: "m3", type: "CONTRADICTS", reason: "different vendor" },
        ],
      }),
      entityEmbeddings: new Map(),
    });

    expect(of(buildMemoryEdgeSql("CONTRADICTS"))).toHaveLength(1);
    expect(of(buildMemoryEdgeSql("SUPERSEDES"))).toHaveLength(0);
    expect(of(buildMemoryEdgeSql("RELATES_TO"))).toHaveLength(0);
    const edges = of(buildMemoryEdgeSql("CONTRADICTS"))[0].params.edges;
    expect(edges).toHaveLength(2);
  });

  it("writes nothing at all but the marker when the extraction is empty", async () => {
    const { run, calls } = recorder();
    await writeEnrichment(run, {
      memoryId: "m1",
      userId: "u1",
      enrichment: enrichment(),
      entityEmbeddings: new Map(),
    });

    expect(calls.filter((call) => call.sql !== MEMORY_ENRICHED_AT_SQL)).toHaveLength(0);
  });
});
