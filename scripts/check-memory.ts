import neo4j from "neo4j-driver";
import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
import {
  MEMORY_EDGE_CANDIDATE_LIMIT,
  MEMORY_TRAVERSABLE_TYPES,
  MEMORY_VECTOR_INDEX_NAMES,
  memorySeedLimit,
} from "@/constants/memory";
import {
  EDGE_CANDIDATE_SQL,
  ENTITY_GC_SQL,
  EXPAND_SQL,
  MEMORY_DELETE_SQL,
  SEED_SQL,
} from "@/lib/memory/cypher";

/**
 * Exercises the memory graph's recall and delete paths against a live Neo4j.
 *
 * Three deliberate choices:
 *
 * 1. It reads `process.env` directly rather than importing `@/lib/config`, for
 *    the reason `setup-mongodb.ts` and `check-storage.ts` document: `lib/config`
 *    is `server-only` and reaches the whole `lib/env.ts` schema, so an unrelated
 *    blank optional var would stop this script from running.
 * 2. It imports the SQL from `@/lib/memory/cypher` — a module with no
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
 * Pre-flight, not one of the six checks: the live indexes must agree with
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
       category:'fact', createdAt:'2026-01-01T00:00:00.000Z',
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
       category:'fact', createdAt:'2026-01-01T00:00:00.000Z',
       updatedAt:'2026-01-01T00:00:00.000Z', embedding:$embedding
     })
     CREATE (m)-[:ABOUT]->(e)`,
    { b: USER_B, embedding: probe },
  );

  // A memory with no vector at all: the seed query must skip it, not error.
  await session.run(
    `CREATE (m:Memory {
       id:'check_a_novector', userId:$a, content:'Acme but unembedded',
       category:'other', createdAt:'2026-01-01T00:00:00.000Z',
       updatedAt:'2026-01-01T00:00:00.000Z'
     })`,
    { a: USER_A },
  );

  const k = memorySeedLimit(5);

  // ---- 1. the seed query finds the user's own memory ----
  const seedResult = await session.run(SEED_SQL, {
    queryVector: probe,
    userId: USER_A,
    k,
  });
  const seedIds = seedResult.records.map((r) => String(r.get("id")));
  report(
    "SEED_SQL returns the target user's memory",
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
  const expandResult = await session.run(EXPAND_SQL, {
    seedIds: ["check_a_1"],
    userId: USER_A,
    allowedTypes: MEMORY_TRAVERSABLE_TYPES,
    expansionLimit: k * 2,
  });
  const expandedIds = expandResult.records.map((r) => String(r.get("id")));
  report(
    "EXPAND_SQL from A's seed returns no B memory via the shared entity name",
    expandedIds.every((id) => !id.startsWith("check_b_")),
    `expanded=[${expandedIds.join(", ")}]`,
  );

  // ---- 3. a path that physically crosses users is refused ----
  // A's entity, reached from B's memory — the `all(x IN nodes(path))` guard.
  await session.run(
    `MATCH (b:Memory {id:'check_b_1'}), (e:Entity {id:'check_a_acme'})
     CREATE (b)-[:ABOUT]->(e)`,
  );
  const crossA = await session.run(EXPAND_SQL, {
    seedIds: ["check_a_1"],
    userId: USER_A,
    allowedTypes: MEMORY_TRAVERSABLE_TYPES,
    expansionLimit: k * 2,
  });
  const crossB = await session.run(EXPAND_SQL, {
    seedIds: ["check_b_1"],
    userId: USER_B,
    allowedTypes: MEMORY_TRAVERSABLE_TYPES,
    expansionLimit: k * 2,
  });
  const crossAIds = crossA.records.map((r) => String(r.get("id")));
  const crossBIds = crossB.records.map((r) => String(r.get("id")));
  report(
    "EXPAND_SQL refuses a path crossing users in either direction",
    crossAIds.every((id) => !id.startsWith("check_b_")) &&
      crossBIds.every((id) => !id.startsWith("check_a_")),
    `fromA=[${crossAIds.join(", ")}] fromB=[${crossBIds.join(", ")}]`,
  );

  // ---- 4. a vectorless memory is skipped, not an error ----
  report(
    "SEED_SQL skips a memory with no embedding instead of erroring",
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
       id:'check_a_2', userId:$a, content:'still here', category:'other',
       createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z'
     })
     CREATE (m2)-[:ABOUT]->(shared)`,
    { a: USER_A },
  );

  await session.executeWrite(async (tx) => {
    await tx.run(MEMORY_DELETE_SQL, { id: "check_a_1", userId: USER_A });
    await tx.run(ENTITY_GC_SQL, { userId: USER_A });
  });
  const afterDelete = await session.run(
    `RETURN EXISTS { MATCH (m:Memory {id:'check_a_1'}) } AS memoryGone,
            EXISTS { MATCH (e:Entity {id:'check_a_exclusive'}) } AS orphanKept,
            EXISTS { MATCH (e:Entity {id:'check_a_shared'}) } AS sharedKept,
            EXISTS { MATCH (:Memory {id:'check_a_1'})-[]->() } AS edgesGone`,
  );
  const row = afterDelete.records[0];
  report(
    "MEMORY_DELETE_SQL + ENTITY_GC_SQL remove the memory, its edges and only its orphaned entities",
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
    { name: MEMORY_VECTOR_INDEX_NAMES.memory },
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
       category:'other', createdAt: row.at, updatedAt: row.at
     })`,
    { a: USER_A },
  );

  const bounded = await session.run(EDGE_CANDIDATE_SQL, {
    userId: USER_A,
    id: "check_a_recent3",
    limit: 2,
  });
  const boundedIds = bounded.records.map((r) => String(r.get("id")));

  let productionBoundOk = true;
  let productionBoundDetail = "ok";
  try {
    const full = await session.run(EDGE_CANDIDATE_SQL, {
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
    "EDGE_CANDIDATE_SQL returns the bounded recent slice, newest first, excluding the memory itself",
    boundedIds.join(",") === "check_a_recent2,check_a_recent1" && productionBoundOk,
    `bounded=[${boundedIds.join(", ")}] atLimit${MEMORY_EDGE_CANDIDATE_LIMIT}=${productionBoundDetail}`,
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
