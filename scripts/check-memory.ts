import neo4j, { type ManagedTransaction } from "neo4j-driver";
import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
import {
  MEMORY_EDGE_CANDIDATE_LIMIT,
  MEMORY_LLM_EDGE_TYPES,
  MEMORY_TRAVERSABLE_TYPES,
  MEMORY_VECTOR_INDEX_NAMES,
  memorySeedLimit,
} from "@/constants/memory";
import {
  EDGE_CANDIDATE_CYPHER,
  ENRICH_PENDING_CYPHER,
  ENTITY_GC_CYPHER,
  EXPAND_CYPHER,
  GRAPH_ABOUT_CYPHER,
  GRAPH_ENTITY_RELATIONS_CYPHER,
  GRAPH_MEMORIES_CYPHER,
  GRAPH_MEMORY_COUNT_CYPHER,
  GRAPH_MEMORY_EDGES_CYPHER,
  MEMORY_DELETE_CYPHER,
  SEED_CYPHER,
} from "@/lib/memory/cypher";
import { writeEnrichment } from "@/lib/memory/enrichment-write";
import type { Enrichment } from "@/lib/memory/enrichment-schema";

/**
 * Exercises the memory graph's recall and delete paths against a live Neo4j.
 *
 * Three deliberate choices:
 *
 * 1. It reads `process.env` directly rather than importing `@/lib/config`, for
 *    the reason `setup-mongodb.ts` and `check-storage.ts` document: `lib/config`
 *    is `server-only` and reaches the whole `lib/env.ts` schema, so an unrelated
 *    blank optional var would stop this script from running.
 * 2. It imports the Cypher from `@/lib/memory/cypher` — a module with no
 *    `"server-only"` guard — so these checks execute the *same* statements the
 *    store does. It cannot import `@/lib/memory/graph-store` (guarded) or
 *    `@/lib/embeddings` (guarded), which is why the vectors below are built by
 *    hand instead of by the provider.
 * 3. The two probe vectors are constructed so the cosines are exact, not
 *    approximate: `A` sits at 0.3 from the probe and `B` at 1.0, which is what
 *    makes check 2's starvation scenario a real one.
 *
 * Cleanup runs in a `finally` and is scoped to the two scratch user ids, so a
 * failed check cannot leave nodes behind.
 */

const USER_A = "__check_a";
const USER_B = "__check_b";
const SCRATCH_USERS = [USER_A, USER_B];

const uri = process.env.NEO4J_URI;
const password = process.env.NEO4J_PASSWORD;
const user = process.env.NEO4J_USER ?? "neo4j";

if (!uri || !password) {
  console.error(
    "NEO4J_URI and NEO4J_PASSWORD must be set. This script reads them from the\n" +
      "environment; the `memory:check` pnpm script loads `.env` for you.",
  );
  process.exit(1);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
  disableLosslessIntegers: true,
});

let failures = 0;
function report(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/**
 * All-float and unit-length. `0` is not used for the same reason: the driver
 * would send an exact zero as an Integer and Neo4j rejects a mixed-type list.
 */
function probeVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? 1.0 : 1e-6,
  );
}

/** Cosine 0.3 against `probeVector()`, by construction. */
function weakerVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? 0.3 : i === 1 ? 0.9539392014169456 : 1e-6,
  );
}

async function clearScratch(session: ReturnType<typeof driver.session>): Promise<void> {
  await session.run("MATCH (n) WHERE n.userId IN $users DETACH DELETE n", {
    users: SCRATCH_USERS,
  });
}

/**
 * Pre-flight, not one of the eight checks: the live indexes must agree with
 * `EMBEDDING_DIMENSIONS` before any vector query can mean anything.
 *
 * Without it a drifted index surfaces as a raw dimensionality error thrown out
 * of whichever vector query happens to run first, which reads like a bug in this
 * script rather than a stale index. Diagnosed here it is one line naming the fix.
 * Returns whether the contract holds.
 */
async function assertIndexContract(
  session: ReturnType<typeof driver.session>,
): Promise<boolean> {
  const expected: string[] = Object.values(MEMORY_VECTOR_INDEX_NAMES);
  const { records } = await session.run(
    `SHOW INDEXES YIELD name, options WHERE name IN $names`,
    { names: expected },
  );
  const live = new Map<string, number | undefined>();
  for (const record of records) {
    live.set(
      String(record.get("name")),
      Number(record.get("options").indexConfig["vector.dimensions"]),
    );
  }

  let ok = true;
  for (const name of expected) {
    const dimensions = live.get(name);
    if (dimensions === EMBEDDING_DIMENSIONS) continue;
    ok = false;
    report(
      `vector index ${name} matches EMBEDDING_DIMENSIONS`,
      false,
      dimensions === undefined
        ? "missing — run: pnpm db:setup:neo4j"
        : `is ${dimensions}, expected ${EMBEDDING_DIMENSIONS} — drop the index and run: pnpm db:setup:neo4j`,
    );
  }
  return ok;
}

/**
 * The `StatementRunner` shape `writeEnrichment` expects, bound to a transaction.
 * `toObject()` keys are the statement's own aliases, which is what
 * `resolveEntityName` reads (`id`, `normalizedName`).
 */
function runner(tx: ManagedTransaction) {
  return async (cypher: string, params: Record<string, unknown>) => {
    const result = await tx.run(cypher, params);
    return result.records.map((record) => record.toObject());
  };
}

async function runChecks(
  session: ReturnType<typeof driver.session>,
): Promise<void> {
  const probe = probeVector();
  const weaker = weakerVector();

  // A: one memory, naming "Acme". B: five hundred, all naming "Acme" and all
  // *more* similar to the probe than A's. This is the crowding scenario §6
  // exists to prevent.
  await session.run(
    `CREATE (m:Memory {
       id:'check_a_1', userId:$a, content:'Acme is our deploy vendor',
       createdAt:'2026-01-01T00:00:00.000Z',
       updatedAt:'2026-01-01T00:00:00.000Z', embedding:$embedding
     })
     CREATE (e:Entity {id:'check_a_acme', userId:$a, normalizedName:'acme', name:'acme'})
     CREATE (m)-[:ABOUT]->(e)`,
    { a: USER_A, embedding: weaker },
  );

  await session.run(
    `CREATE (e:Entity {id:'check_b_acme', userId:$b, normalizedName:'acme', name:'acme'})
     WITH e
     UNWIND range(1, 500) AS i
     CREATE (m:Memory {
       id:'check_b_' + i, userId:$b, content:'Acme memory ' + i,
       createdAt:'2026-01-01T00:00:00.000Z',
       updatedAt:'2026-01-01T00:00:00.000Z', embedding:$embedding
     })
     CREATE (m)-[:ABOUT]->(e)`,
    { b: USER_B, embedding: probe },
  );

  // A memory with no vector at all: the seed query must skip it, not error.
  await session.run(
    `CREATE (m:Memory {
       id:'check_a_novector', userId:$a, content:'Acme but unembedded',
       createdAt:'2026-01-01T00:00:00.000Z',
       updatedAt:'2026-01-01T00:00:00.000Z'
     })`,
    { a: USER_A },
  );

  const k = memorySeedLimit(5);

  // ---- 1. the seed query finds the user's own memory ----
  const seedResult = await session.run(SEED_CYPHER, {
    queryVector: probe,
    userId: USER_A,
    k,
  });
  const seedIds = seedResult.records.map((r) => String(r.get("id")));
  report(
    "SEED_CYPHER returns the target user's memory",
    seedIds.includes("check_a_1"),
    `ids=[${seedIds.join(", ")}]`,
  );

  // ---- 2. tenant isolation: B must never appear ----
  const leaked = seedIds.filter((id) => id.startsWith("check_b_"));
  report(
    "tenant isolation — another user's 500 nearer memories do not crowd out or leak",
    seedIds.length > 0 && leaked.length === 0,
    `returned=${seedIds.length} leaked=${leaked.length}`,
  );

  // A shared entity name is not a bridge: B's "acme" is a different node.
  const expandResult = await session.run(EXPAND_CYPHER, {
    seedIds: ["check_a_1"],
    userId: USER_A,
    allowedTypes: MEMORY_TRAVERSABLE_TYPES,
    expansionLimit: k * 2,
  });
  const expandedIds = expandResult.records.map((r) => String(r.get("id")));
  report(
    "EXPAND_CYPHER from A's seed returns no B memory via the shared entity name",
    expandedIds.every((id) => !id.startsWith("check_b_")),
    `expanded=[${expandedIds.join(", ")}]`,
  );

  // ---- 3. a path that physically crosses users is refused ----
  // A's entity, reached from B's memory — the `all(x IN nodes(path))` guard.
  await session.run(
    `MATCH (b:Memory {id:'check_b_1'}), (e:Entity {id:'check_a_acme'})
     CREATE (b)-[:ABOUT]->(e)`,
  );
  const crossA = await session.run(EXPAND_CYPHER, {
    seedIds: ["check_a_1"],
    userId: USER_A,
    allowedTypes: MEMORY_TRAVERSABLE_TYPES,
    expansionLimit: k * 2,
  });
  const crossB = await session.run(EXPAND_CYPHER, {
    seedIds: ["check_b_1"],
    userId: USER_B,
    allowedTypes: MEMORY_TRAVERSABLE_TYPES,
    expansionLimit: k * 2,
  });
  const crossAIds = crossA.records.map((r) => String(r.get("id")));
  const crossBIds = crossB.records.map((r) => String(r.get("id")));
  report(
    "EXPAND_CYPHER refuses a path crossing users in either direction",
    crossAIds.every((id) => !id.startsWith("check_b_")) &&
      crossBIds.every((id) => !id.startsWith("check_a_")),
    `fromA=[${crossAIds.join(", ")}] fromB=[${crossBIds.join(", ")}]`,
  );

  // ---- 4. a vectorless memory is skipped, not an error ----
  report(
    "SEED_CYPHER skips a memory with no embedding instead of erroring",
    !seedIds.includes("check_a_novector"),
    `returned=${seedIds.join(", ")}`,
  );

  // ---- 5. delete removes the edges, and GC takes only the orphans ----
  await session.run(
    `CREATE (shared:Entity {id:'check_a_shared', userId:$a, normalizedName:'shared', name:'shared'})
     CREATE (exclusive:Entity {id:'check_a_exclusive', userId:$a, normalizedName:'exclusive', name:'exclusive'})
     WITH shared, exclusive
     MATCH (m1:Memory {id:'check_a_1'})
     CREATE (m1)-[:ABOUT]->(shared)
     CREATE (m1)-[:ABOUT]->(exclusive)
     CREATE (m2:Memory {
       id:'check_a_2', userId:$a, content:'still here',
       createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z'
     })
     CREATE (m2)-[:ABOUT]->(shared)`,
    { a: USER_A },
  );

  await session.executeWrite(async (tx) => {
    await tx.run(MEMORY_DELETE_CYPHER, { id: "check_a_1", userId: USER_A });
    await tx.run(ENTITY_GC_CYPHER, { userId: USER_A });
  });
  const afterDelete = await session.run(
    `RETURN EXISTS { MATCH (m:Memory {id:'check_a_1'}) } AS memoryGone,
            EXISTS { MATCH (e:Entity {id:'check_a_exclusive'}) } AS orphanKept,
            EXISTS { MATCH (e:Entity {id:'check_a_shared'}) } AS sharedKept,
            EXISTS { MATCH (:Memory {id:'check_a_1'})-[]->() } AS edgesGone`,
  );
  const row = afterDelete.records[0];
  report(
    "MEMORY_DELETE_CYPHER + ENTITY_GC_CYPHER remove the memory, its edges and only its orphaned entities",
    row.get("memoryGone") === false &&
      row.get("orphanKept") === false &&
      row.get("sharedKept") === true &&
      row.get("edgesGone") === false,
    `memoryGone=${row.get("memoryGone")} orphanKept=${row.get("orphanKept")} sharedKept=${row.get("sharedKept")}`,
  );

  // ---- 6. the recall path's index is in-index filterable by userId ----
  const indexResult = await session.run(
    `SHOW INDEXES YIELD name, type, properties
     WHERE type = 'VECTOR' AND name = $name`,
    { name: "memory_embedding" },
  );
  const indexRecord = indexResult.records[0];
  const properties: string[] = indexRecord ? indexRecord.get("properties") : [];
  report(
    "memory_embedding is in-index filterable by userId",
    Boolean(indexRecord) && properties.includes("userId"),
    `properties=[${properties.join(", ")}]`,
  );

  // ---- 7. the edge candidate window reads a bounded recent slice ----
  // This one exists because a live run found it broken: the driver sends plain
  // JS numbers as Double, so `LIMIT $n` raised 22003 until the statement coerced
  // with toInteger. Nothing else covers this statement — the store is
  // server-only, so the check is the only thing that executes it.
  await session.run(
    `UNWIND [
       {id:'check_a_recent1', at:'2026-03-01T00:00:00.000Z'},
       {id:'check_a_recent2', at:'2026-03-02T00:00:00.000Z'},
       {id:'check_a_recent3', at:'2026-03-03T00:00:00.000Z'}
     ] AS row
     CREATE (m:Memory {
       id: row.id, userId: $a, content:'Recent memory ' + row.id,
       createdAt: row.at, updatedAt: row.at
     })`,
    { a: USER_A },
  );

  const bounded = await session.run(EDGE_CANDIDATE_CYPHER, {
    userId: USER_A,
    id: "check_a_recent3",
    limit: 2,
  });
  const boundedIds = bounded.records.map((r) => String(r.get("id")));

  let productionBoundOk = true;
  let productionBoundDetail = "ok";
  try {
    const full = await session.run(EDGE_CANDIDATE_CYPHER, {
      userId: USER_A,
      id: "check_a_recent3",
      limit: MEMORY_EDGE_CANDIDATE_LIMIT,
    });
    const fullIds = full.records.map((r) => String(r.get("id")));
    productionBoundOk =
      fullIds.includes("check_a_recent1") &&
      fullIds.includes("check_a_recent2") &&
      fullIds.includes("check_a_2") &&
      !fullIds.includes("check_a_recent3");
    productionBoundDetail = `returned=${fullIds.length}`;
  } catch (error) {
    productionBoundOk = false;
    productionBoundDetail = `threw: ${(error as Error).message.split("\n")[0]}`;
  }

  report(
    "EDGE_CANDIDATE_CYPHER returns the bounded recent slice, newest first, excluding the memory itself",
    boundedIds.join(",") === "check_a_recent2,check_a_recent1" && productionBoundOk,
    `bounded=[${boundedIds.join(", ")}] atLimit${MEMORY_EDGE_CANDIDATE_LIMIT}=${productionBoundDetail}`,
  );

  // ---- 8. the enrichment write path, and the sweep's selection ----
  // Deterministic on purpose. `writeEnrichment` is driver-free, so this really
  // does execute the store's own write path — but the model call in front of it
  // needs a live provider, and a check that needs one goes red for reasons that
  // have nothing to do with this schema (and costs a token per run). The model
  // boundary is covered by tests/lib/memory/llm-extraction.test.ts with a faked
  // transport; what only a live database can answer is whether these statements
  // run at all.
  await session.run(
    `CREATE (m:Memory {
       id:'check_a_enrich', userId:$a, content:'Acme replaced Globex',
       createdAt:'2026-04-01T00:00:00.000Z',
       updatedAt:'2026-04-01T00:00:00.000Z'
     })
     CREATE (target:Memory {
       id:'check_a_target', userId:$a, content:'Globex is our vendor',
       createdAt:'2026-04-01T00:00:00.000Z',
       updatedAt:'2026-04-01T00:00:00.000Z'
     })
     CREATE (empty:Memory {
       id:'check_a_empty', userId:$a, content:'Nothing to extract',
       createdAt:'2026-04-01T00:00:00.000Z',
       updatedAt:'2026-04-01T00:00:00.000Z', embedding:$embedding
     })
     CREATE (foreign:Memory {
       id:'check_b_target', userId:$b, content:'Globex is our vendor',
       createdAt:'2026-04-01T00:00:00.000Z',
       updatedAt:'2026-04-01T00:00:00.000Z'
     })`,
    { a: USER_A, b: USER_B, embedding: weaker },
  );

  const extraction: Enrichment = {
    entities: [
      { name: "Acme", normalizedName: "acme", type: "organization" },
      { name: "Globex", normalizedName: "globex", type: "organization" },
    ],
    relations: [{ from: "acme", to: "globex", type: "replaced" }],
    memoryEdges: [
      // The second one names another user's memory. It is the case the
      // `userId` in the target MATCH exists to refuse, and the case nothing
      // else in this script covers.
      { targetId: "check_a_target", type: "SUPERSEDES", reason: "same vendor" },
      { targetId: "check_b_target", type: "SUPERSEDES", reason: "another user" },
    ],
  };

  await session.executeWrite(async (tx) => {
    await writeEnrichment(runner(tx), {
      memoryId: "check_a_enrich",
      userId: USER_A,
      enrichment: extraction,
      // No vectors: resolution then exact-matches, which is the branch a
      // provider outage leaves the store in.
      entityEmbeddings: new Map(),
    });
    await writeEnrichment(runner(tx), {
      memoryId: "check_a_empty",
      userId: USER_A,
      enrichment: { entities: [], relations: [], memoryEdges: [] },
      entityEmbeddings: new Map(),
    });
  });

  const enriched = await session.run(
    `MATCH (m:Memory)
     OPTIONAL MATCH (m)-[:ABOUT]->(e:Entity)
     OPTIONAL MATCH (m)-[r:SUPERSEDES]->(other:Memory)
     RETURN m.id AS id, m.enrichedAt AS enrichedAt,
            collect(DISTINCT e.normalizedName) AS entities,
            collect(DISTINCT other.id) AS superseded
     ORDER BY id`,
  );
  const rows = new Map(
    enriched.records.map((record) => [String(record.get("id")), record]),
  );
  const main = rows.get("check_a_enrich");
  const empty = rows.get("check_a_empty");

  const relation = await session.run(
    `MATCH (a:Entity {userId:$a, normalizedName:'acme'})-[r:RELATION]->(b:Entity {userId:$a, normalizedName:'globex'})
     RETURN r.type AS type, count(r) AS n`,
    { a: USER_A },
  );

  // The sweep's two predicates, told apart by the two scratch memories above:
  // `check_a_enrich` is enriched and has no vector, so the `embedding IS NULL`
  // arm must still select it; `check_a_empty` is enriched *and* embedded, so
  // neither arm may. The empty extraction is the case that would otherwise
  // re-enqueue a memory forever, because it writes no edges.
  // Above the whole scratch corpus, not just the two rows under test. The
  // statement has no user filter — it is a global sweep, and that is correct —
  // so a limit below the scratch count truncates the very rows being asserted
  // on, and check 2's 500 memories have no `enrichedAt` at all, which counts as
  // null.
  const pending = await session.run(ENRICH_PENDING_CYPHER, { limit: 1000 });
  const pendingIds = pending.records.map((record) => String(record.get("id")));

  const entities = (main?.get("entities") as string[]) ?? [];
  const superseded = (main?.get("superseded") as string[]) ?? [];
  report(
    "writeEnrichment writes entities, a RELATION, a same-user memory edge, and the marker",
    main?.get("enrichedAt") !== null &&
      main?.get("enrichedAt") !== undefined &&
      entities.includes("acme") &&
      entities.includes("globex") &&
      Number(relation.records[0]?.get("n")) === 1 &&
      relation.records[0]?.get("type") === "replaced" &&
      superseded.includes("check_a_target") &&
      !superseded.includes("check_b_target") &&
      empty?.get("enrichedAt") !== null &&
      empty?.get("enrichedAt") !== undefined &&
      pendingIds.includes("check_a_enrich") &&
      !pendingIds.includes("check_a_empty"),
    `enrichedAt=${main?.get("enrichedAt")} entities=[${entities.join(", ")}] ` +
      `relation=${relation.records[0]?.get("type")} superseded=[${superseded.join(", ")}] ` +
      `emptyStamped=${empty?.get("enrichedAt") !== null} ` +
      `pending=[${pendingIds.filter((id) => id.startsWith("check_a_")).join(", ")}]`,
  );

  // ---- 9. the graph view's reads ----
  // Nothing else executes these: the store is `server-only`, so this script is
  // the only place they run against a real server. Three properties are worth a
  // live check and are invisible to any other kind of test — the standalone
  // LIMIT needs its `toInteger` coercion (the driver sends Double, and a bare
  // `LIMIT $n` raises 22003), each branch has to carry the tenant into the
  // MATCH rather than filtering after it, and the id window has to be what
  // bounds the edges rather than a full scan.
  //
  // The two cross-tenant edges below are written directly rather than through a
  // store method, because no store method will produce them: they stand in for
  // the one thing the `e.userId` / `b.userId` checks exist for and that nothing
  // else in the script covers — a future writer merging a node across users.
  await session.run(
    `CREATE (g1:Memory {id:'check_a_graph1', userId:$a, content:'The deploy window is Friday',
        createdAt:'2026-05-01T00:00:00.000Z', updatedAt:'2026-05-01T00:00:00.000Z'})
     CREATE (g2:Memory {id:'check_a_graph2', userId:$a, content:'We deploy on Fridays',
        createdAt:'2026-05-02T00:00:00.000Z', updatedAt:'2026-05-02T00:00:00.000Z'})
     CREATE (g3:Memory {id:'check_a_graph3', userId:$a, content:'Older than both',
        createdAt:'2026-04-30T00:00:00.000Z', updatedAt:'2026-04-30T00:00:00.000Z'})
     CREATE (e1:Entity {id:'check_a_graph_e1', userId:$a, normalizedName:'graphcorp', name:'Graphcorp'})
     CREATE (e2:Entity {id:'check_a_graph_e2', userId:$a, normalizedName:'graphlabs', name:'Graph Labs'})
     CREATE (bf:Memory {id:'check_b_graph1', userId:$b, content:'Another tenant',
        createdAt:'2026-05-03T00:00:00.000Z', updatedAt:'2026-05-03T00:00:00.000Z'})
     CREATE (bfe:Entity {id:'check_b_graph_e1', userId:$b, normalizedName:'graphcorp', name:'Graphcorp'})
     CREATE (g1)-[:ABOUT]->(e1)
     CREATE (g2)-[:ABOUT]->(e2)
     CREATE (g1)-[:RELATES_TO {weight:0.5}]->(g2)
     CREATE (g2)-[:SUPERSEDES {reason:'newer window'}]->(g3)
     CREATE (e1)-[:RELATION {type:'employs'}]->(e2)
     CREATE (g1)-[:RELATES_TO {weight:0.9}]->(bf)
     CREATE (g1)-[:ABOUT]->(bfe)`,
    { a: USER_A, b: USER_B },
  );

  const graphWindow = await session.run(GRAPH_MEMORIES_CYPHER, {
    userId: USER_A,
    limit: 2,
  });
  const windowIds = graphWindow.records.map((r) => String(r.get("id")));

  const graphCount = await session.run(GRAPH_MEMORY_COUNT_CYPHER, { userId: USER_A });
  const totalForA = Number(graphCount.records[0]?.get("total") ?? -1);
  // The expectation is computed here rather than written as a literal, so this
  // does not rot when a fixture is added — and it still catches the failure that
  // matters: a pattern that lost its `{userId}`, which would count every tenant.
  const expectedForA = await session.run(
    "MATCH (m:Memory {userId:$a}) RETURN count(m) AS n",
    { a: USER_A },
  );
  const allMemories = await session.run("MATCH (m:Memory) RETURN count(m) AS n");
  const totalForEveryone = Number(allMemories.records[0]?.get("n") ?? 0);

  const about = await session.run(GRAPH_ABOUT_CYPHER, {
    userId: USER_A,
    memoryIds: ["check_a_graph1", "check_a_graph2"],
  });
  const aboutEntities = about.records
    .map((r) => String(r.get("entityId")))
    .sort();

  // `check_b_graph1` is in the id list on purpose. The window alone would admit
  // it; only the pattern's `userId` can refuse it, so this asserts that the
  // tenant check is doing work the id filter is not.
  const graphEdgeWindow = [
    "check_a_graph1",
    "check_a_graph2",
    "check_a_graph3",
    "check_b_graph1",
  ];
  const edgesInWindow = await session.run(GRAPH_MEMORY_EDGES_CYPHER, {
    userId: USER_A,
    memoryIds: graphEdgeWindow,
    edgeTypes: [...MEMORY_LLM_EDGE_TYPES],
  });
  const edgeKeys = edgesInWindow.records
    .map((r) => `${r.get("source")}->${r.get("target")}:${r.get("type")}`)
    .sort();

  const edgesNarrowed = await session.run(GRAPH_MEMORY_EDGES_CYPHER, {
    userId: USER_A,
    memoryIds: ["check_a_graph1", "check_a_graph2"],
    edgeTypes: [...MEMORY_LLM_EDGE_TYPES],
  });

  const edgesOtherType = await session.run(GRAPH_MEMORY_EDGES_CYPHER, {
    userId: USER_A,
    memoryIds: ["check_a_graph1", "check_a_graph2", "check_a_graph3"],
    edgeTypes: ["CONTRADICTS"],
  });

  const relations = await session.run(GRAPH_ENTITY_RELATIONS_CYPHER, {
    userId: USER_A,
    entityIds: ["check_a_graph_e1", "check_a_graph_e2"],
  });

  const relationsNarrowed = await session.run(GRAPH_ENTITY_RELATIONS_CYPHER, {
    userId: USER_A,
    entityIds: ["check_a_graph_e1"],
  });

  report(
    "GRAPH_MEMORIES_CYPHER reads the newest slice, and the LIMIT coercion holds",
    windowIds.join(",") === "check_a_graph2,check_a_graph1",
    `window=[${windowIds.join(", ")}]`,
  );

  report(
    "GRAPH_MEMORY_COUNT_CYPHER counts one tenant's memories",
    totalForA === Number(expectedForA.records[0]?.get("n") ?? -2) &&
      totalForEveryone - totalForA > 400,
    `forA=${totalForA} everyone=${totalForEveryone}`,
  );

  report(
    "GRAPH_ABOUT_CYPHER returns the window's entities, not another tenant's",
    aboutEntities.join(",") === "check_a_graph_e1,check_a_graph_e2",
    `entities=[${aboutEntities.join(", ")}]`,
  );

  report(
    "GRAPH_MEMORY_EDGES_CYPHER scopes to the window and to the tenant",
    edgeKeys.join(",") ===
      "check_a_graph1->check_a_graph2:RELATES_TO,check_a_graph2->check_a_graph3:SUPERSEDES",
    `edges=[${edgeKeys.join(", ")}]`,
  );

  report(
    "GRAPH_MEMORY_EDGES_CYPHER drops an edge whose other endpoint is outside the window",
    edgesNarrowed.records.length === 1 &&
      String(edgesNarrowed.records[0]?.get("source")) === "check_a_graph1",
    `n=${edgesNarrowed.records.length}`,
  );

  report(
    "GRAPH_MEMORY_EDGES_CYPHER returns nothing for a type it was not asked for",
    edgesOtherType.records.length === 0,
    `n=${edgesOtherType.records.length}`,
  );

  report(
    "GRAPH_ENTITY_RELATIONS_CYPHER names the relation and needs both endpoints in the window",
    relations.records.length === 1 &&
      String(relations.records[0]?.get("relationType")) === "employs" &&
      String(relations.records[0]?.get("source")) === "check_a_graph_e1" &&
      relationsNarrowed.records.length === 0,
    `n=${relations.records.length} type=${relations.records[0]?.get("relationType")} ` +
      `halfWindow=${relationsNarrowed.records.length}`,
  );
}

async function main(): Promise<void> {
  const session = driver.session();
  try {
    await clearScratch(session);
    if (await assertIndexContract(session)) {
      await runChecks(session);
    }
  } finally {
    try {
      await clearScratch(session);
    } finally {
      await session.close();
      await driver.close();
    }
  }

  if (failures === 0) {
    console.log("\nall checks passed");
  } else {
    console.log(`\n${failures} check(s) failed`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("memory check failed to run:", error);
  process.exit(1);
});
