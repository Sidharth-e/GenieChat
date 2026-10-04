/**
 * Exercises the fact graph against a live Neo4j.
 *
 * Four deliberate choices:
 *
 * 1. It reads `process.env` and builds its own driver rather than importing
 *    `@/lib/neo4j/client` or `@/lib/config`: both carry the `"server-only"`
 *    guard, which Next aliases at build time and `tsx` does not resolve at all.
 * 2. It imports the Cypher from `@/lib/memory/cypher` — a module with no guard —
 *    so these checks execute the *same* statements the store does rather than a
 *    copy of them. It cannot import `@/lib/memory/graph-store` for the same
 *    reason, so what is asserted here is statement-level: the dedup and supersede
 *    *decisions* are TypeScript and are unit-tested instead.
 * 3. Every vector is `EMBEDDING_DIMENSIONS` long. The four vector indexes are
 *    created at that width and Neo4j rejects a vector that does not match, so a
 *    hand-written two-element fixture would fail on the write rather than on the
 *    assertion it was meant to make.
 * 4. An unconfigured Neo4j is a **failure**, not a skip. The script's whole job
 *    is to exercise a live graph, and exiting 0 on an environment where nothing
 *    ran would report success for work that never happened.
 *
 * Each check writes its fixture under a throwaway `userId`, asserts, then deletes
 * what it made — so a re-run is unaffected by the previous one and a real user's
 * graph is never touched.
 */
import { randomUUID } from "node:crypto";
import neo4j, { type Driver } from "neo4j-driver";
import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
import { MEMORY_CAPTURE_MAX_ATTEMPTS } from "@/constants/memory";
import {
  buildFactCreateCypher,
  buildOrphanGcCypher,
  CAPTURE_COUNT_CYPHER,
  CAPTURE_CREATE_CYPHER,
  CAPTURE_PENDING_CYPHER,
  CAPTURE_RETRY_CYPHER,
  ENTITY_ALIAS_CYPHER,
  ENTITY_CREATE_CYPHER,
  ENTITY_EXACT_CYPHER,
  FACT_CLOSE_CYPHER,
  FACT_COUNT_ALL_CYPHER,
  FACT_CURRENT_CYPHER,
  FACT_EDGES_CYPHER,
  FACT_EXPAND_CYPHER,
  FACT_LIST_CYPHER,
  FACT_SEED_CYPHER,
  PREDICATE_CREATE_CYPHER,
  PREDICATE_GET_CYPHER,
  PREDICATE_LIST_CYPHER,
  PREDICATE_MERGE_CYPHER,
  TEST_GC_CYPHER,
  USER_UPSERT_CYPHER,
} from "@/lib/memory/cypher";

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

/**
 * All-float and unit-length, at the width the indexes are built for.
 * Deliberately not `[1, 0]`: a shorter vector is rejected by the index on write,
 * which would turn a fixture into an error about dimensionality.
 */
function probeVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? 1.0 : 1e-6,
  );
}

/**
 * Cosine 0.9 against `probeVector()`, by construction: both carry the same
 * trailing filler, so the filler cancels out of the angle and only the first two
 * entries decide it. Only the *ordering* matters to the check that uses this —
 * a nearer foreign fact must be able to take a slot mine would otherwise have.
 */
function weakerVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? 0.9 : i === 1 ? 0.4358898943540674 : 1e-6,
  );
}

const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  FAIL  ${name}`);
    console.error(
      `        ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

interface Fixture {
  driver: Driver;
  userId: string;
}

async function fixture(): Promise<Fixture> {
  const userId = randomUUID();
  // The anchor has to exist before any fact can hang off it — `:User` carries no
  // `userId`, so `TEST_GC_CYPHER` will not collect it. Delete it by id instead.
  await driver.executeQuery(USER_UPSERT_CYPHER, {
    userId,
    name: "Check Fixture",
    email: "check@example.invalid",
  });
  return { driver, userId };
}

async function cleanup({ userId }: Fixture): Promise<void> {
  await driver.executeQuery(TEST_GC_CYPHER, { userId });
  await driver.executeQuery("MATCH (u:User {id: $userId}) DETACH DELETE u", {
    userId,
  });
}

async function makeEntity(
  { userId }: Fixture,
  normalizedName: string,
  name: string,
): Promise<string> {
  const result = await driver.executeQuery(ENTITY_CREATE_CYPHER, {
    id: randomUUID(),
    userId,
    normalizedName,
    name,
    embedding: null,
  });
  return String(result.records[0].get("id"));
}

async function makePredicate(
  { userId }: Fixture,
  canonicalName: string,
): Promise<string> {
  const result = await driver.executeQuery(PREDICATE_CREATE_CYPHER, {
    id: randomUUID(),
    userId,
    canonicalName,
    embedding: null,
  });
  return String(result.records[0].get("id"));
}

async function makeFact(
  f: Fixture,
  subjectId: string,
  predicateId: string,
  objectId: string,
  subjectLabel: "User" | "Entity" | "Value" = "Entity",
  objectLabel: "User" | "Entity" | "Value" = "Entity",
  sourceText = "fixture",
  embedding: number[] = probeVector(),
): Promise<string> {
  const factId = randomUUID();
  await driver.executeQuery(buildFactCreateCypher(subjectLabel, objectLabel), {
    id: factId,
    userId: f.userId,
    subjectId,
    objectId,
    predicateId,
    embedding,
    confidence: 1,
    sourceText,
    now: new Date().toISOString(),
  });
  return factId;
}

async function currentObjectIds(
  f: Fixture,
  subjectId: string,
  predicateId: string,
): Promise<string[]> {
  const result = await driver.executeQuery(FACT_CURRENT_CYPHER, {
    userId: f.userId,
    subjectId,
    predicateId,
  });
  return result.records.map((record) => String(record.get("objectId")));
}

async function main(): Promise<void> {
  console.log("Memory fact-graph checks\n");

  // 1 — a capture is an event, not a key. A MERGE would collapse two identical
  // saves into one row, and the second save is a second occurrence the user
  // asked to remember.
  await check("capture is an event, not a key", async () => {
    const f = await fixture();
    const text = "I prefer dark mode";
    for (let i = 0; i < 2; i += 1) {
      await driver.executeQuery(CAPTURE_CREATE_CYPHER, {
        id: randomUUID(),
        userId: f.userId,
        text,
        embedding: probeVector(),
        createdAt: new Date().toISOString(),
      });
    }
    const counted = await driver.executeQuery(CAPTURE_COUNT_CYPHER, {
      userId: f.userId,
    });
    assert(
      Number(counted.records[0].get("total")) === 2,
      "two identical captures must be two rows",
    );
    await cleanup(f);
  });

  // 2 — attempts bound the sweep. This is the property that stops a permanently
  // unreadable sentence from costing a model call on every sweep, forever.
  await check("capture attempts bound the sweep", async () => {
    const f = await fixture();
    const id = randomUUID();
    await driver.executeQuery(CAPTURE_CREATE_CYPHER, {
      id,
      userId: f.userId,
      text: "unparseable",
      embedding: null,
      createdAt: new Date().toISOString(),
    });

    const pending = async () =>
      (
        await driver.executeQuery(CAPTURE_PENDING_CYPHER, {
          userId: f.userId,
          maxAttempts: MEMORY_CAPTURE_MAX_ATTEMPTS,
          limit: 10,
        })
      ).records.length;

    for (let i = 0; i < MEMORY_CAPTURE_MAX_ATTEMPTS - 1; i += 1) {
      await driver.executeQuery(CAPTURE_RETRY_CYPHER, { id, userId: f.userId });
    }
    assert(
      (await pending()) === 1,
      "a capture under the attempt cap must still be pending",
    );

    await driver.executeQuery(CAPTURE_RETRY_CYPHER, { id, userId: f.userId });
    assert(
      (await pending()) === 0,
      "a capture at the attempt cap must drop out of the worklist",
    );

    // Spent, not lost: the sentence is still on disk.
    const counted = await driver.executeQuery(CAPTURE_COUNT_CYPHER, {
      userId: f.userId,
    });
    assert(
      Number(counted.records[0].get("total")) === 1,
      "a spent capture must not be deleted",
    );
    await cleanup(f);
  });

  // 3 — entity dedup is by normalized name, and aliases accumulate once.
  await check("entity dedup is by normalized name", async () => {
    const f = await fixture();
    const first = await makeEntity(f, "apple", "Apple");
    const second = await makeEntity(f, "apple", "apple");

    const found = await driver.executeQuery(ENTITY_EXACT_CYPHER, {
      userId: f.userId,
      normalizedName: "apple",
    });
    assert(found.records.length === 1, "one normalized name must be one node");
    const id = String(found.records[0].get("id"));

    for (const alias of ["Apple", "apple", "Apple"]) {
      await driver.executeQuery(ENTITY_ALIAS_CYPHER, {
        id,
        userId: f.userId,
        alias,
      });
    }
    const aliases = (
      await driver.executeQuery(
        "MATCH (e:Entity {id: $id, userId: $userId}) RETURN e.aliases AS aliases",
        { id, userId: f.userId },
      )
    ).records[0].get("aliases") as string[];

    assert(
      aliases.length === 2,
      `aliases must not repeat: got ${JSON.stringify(aliases)}`,
    );
    assert(
      first === id && second === id,
      "MERGE must return the existing id, not a new one",
    );
    await cleanup(f);
  });

  // 4 — current reporting, and close rather than delete. This does not test
  // dedup — that decision is `decideFactWrite`, unit-tested. What it pins is that
  // the statement hands the decision what it needs: given the incoming object id,
  // `FACT_CURRENT_CYPHER` returns it, so the decision returns "noop" and the
  // store writes nothing. That is the seam between the tested decision and the
  // live graph, and it is where a wrong RETURN would silently break dedup.
  await check("current reporting closes rather than deletes", async () => {
    const f = await fixture();
    const subject = await makeEntity(f, "apple", "Apple");
    const object = await makeEntity(f, "iphone", "iPhone");
    const predicate = await makePredicate(f, "PRODUCT_OF");

    const factId = await makeFact(f, subject, predicate, object);
    assert(
      (await currentObjectIds(f, subject, predicate)).includes(object),
      "the current set must surface the object id the dedup decision compares against",
    );

    await driver.executeQuery(FACT_CLOSE_CYPHER, {
      userId: f.userId,
      factIds: [factId],
      now: new Date().toISOString(),
    });

    assert(
      (await currentObjectIds(f, subject, predicate)).length === 0,
      "a closed fact must not be reported as current",
    );
    const counted = await driver.executeQuery(FACT_COUNT_ALL_CYPHER, {
      userId: f.userId,
    });
    assert(
      Number(counted.records[0].get("total")) === 1,
      "closing must not delete",
    );
    assert(
      Number(counted.records[0].get("current")) === 0,
      "isCurrent must be false after close",
    );

    // Closing twice is a no-op, so a raced reconcile cannot rewrite validTo.
    const again = await driver.executeQuery(FACT_CLOSE_CYPHER, {
      userId: f.userId,
      factIds: [factId],
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    assert(
      Number(again.records[0].get("closed")) === 0,
      "an already-closed fact must not re-close",
    );
    await cleanup(f);
  });

  // 5 — recall seeds only this tenant's current facts, and the tenant filter does
  // its work *inside* the SEARCH rather than after it. Both halves matter: a
  // post-filter would drop a foreign row from the result, but only once the row
  // had already taken one of the k slots, so a user with a busy neighbour would
  // lose their own nearest facts to facts they cannot see.
  await check("seeding is current-only and tenant-scoped", async () => {
    const mine = await fixture();
    const theirs = await fixture();

    const mySubject = await makeEntity(mine, "apple", "Apple");
    const myObject = await makeEntity(mine, "iphone", "iPhone");
    const myPredicate = await makePredicate(mine, "PRODUCT_OF");
    // Mine is the *weaker* match, so a foreign fact that ties or beats it is
    // what decides whether the filter ran before or after the limit.
    const myFact = await makeFact(
      mine,
      mySubject,
      myPredicate,
      myObject,
      "Entity",
      "Entity",
      "fixture",
      weakerVector(),
    );

    const seeded = async () =>
      (
        await driver.executeQuery(FACT_SEED_CYPHER, {
          userId: mine.userId,
          queryVector: probeVector(),
          k: 10,
        })
      ).records.map((record) => String(record.get("id")));

    // Ten nearer facts under another tenant: enough to fill k on their own. An
    // in-index filter never sees them; a post-filter would rank them first and
    // then discard every one, leaving this user's own fact outside the limit.
    const theirSubject = await makeEntity(theirs, "apple", "Apple");
    const theirPredicate = await makePredicate(theirs, "PRODUCT_OF");
    for (let i = 0; i < 10; i += 1) {
      const theirObject = await makeEntity(theirs, `device-${i}`, `Device ${i}`);
      await makeFact(
        theirs,
        theirSubject,
        theirPredicate,
        theirObject,
        "Entity",
        "Entity",
        "fixture",
        probeVector(),
      );
    }

    assert(
      (await seeded()).includes(myFact),
      "a fact nearer than mine, owned by someone else, must not take my slot",
    );

    await driver.executeQuery(FACT_CLOSE_CYPHER, {
      userId: mine.userId,
      factIds: [myFact],
      now: new Date().toISOString(),
    });
    assert(!(await seeded()).includes(myFact), "a closed fact must not seed");

    await cleanup(mine);
    await cleanup(theirs);
  });

  // 6 — expansion never routes through the user anchor. Every personal fact hangs
  // off `:User`, so fact -> user -> fact reaches the entire corpus. Without this,
  // recall would return everything the moment a user has two facts.
  await check("expansion never routes through the user anchor", async () => {
    const f = await fixture();
    // The anchor is deliberately stamped with a `userId` it does not normally
    // carry. Without the stamp the *tenant* clause is what blocks the walk — the
    // anchor has no `userId` to match — and this check would pass with the
    // `:User` exclusion deleted, testing a guard it never exercised. Mutation
    // testing caught exactly that. With the stamp, the tenant clause cannot help
    // and the exclusion is the only thing standing between two facts that share
    // nothing but their owner.
    await driver.executeQuery(
      "MATCH (u:User {id: $userId}) SET u.userId = $userId",
      { userId: f.userId },
    );
    const predicate = await makePredicate(f, "LIKES");
    const productOf = await makePredicate(f, "PRODUCT_OF");

    const apple = await makeEntity(f, "apple", "Apple");
    const banana = await makeEntity(f, "banana", "Banana");

    const factA = await makeFact(f, f.userId, predicate, apple, "User", "Entity");
    const factB = await makeFact(
      f,
      f.userId,
      predicate,
      banana,
      "User",
      "Entity",
    );

    const expand = async (seedIds: string[]) =>
      (
        await driver.executeQuery(FACT_EXPAND_CYPHER, {
          userId: f.userId,
          seedIds,
          expansionLimit: 50,
        })
      ).records.map((record) => String(record.get("id")));

    // Both facts share only the anchor. Reaching one from the other would be the
    // corpus-wide walk the exclusion exists to prevent.
    assert(
      !(await expand([factA])).includes(factB),
      "two facts sharing only :User must not reach each other",
    );

    // Now give them a shared entity: apple is a product of the company, and the
    // seed reaches it through the object end. The expansion returns what it
    // *reached*, not the seed, so one shared neighbour is a result of one.
    const company = await makeEntity(f, "apple-inc", "Apple Inc");
    const factC = await makeFact(f, apple, productOf, company);

    assert(
      (await expand([factA])).includes(factC),
      "a shared entity must connect the two facts",
    );
    await cleanup(f);
  });

  // 7 — merging predicates rewires the facts and folds the loser's name in.
  await check("merging predicates rewires and folds the alias", async () => {
    const f = await fixture();
    const keep = await makePredicate(f, "PRODUCT_OF");
    const dup = await makePredicate(f, "MADE_BY");
    const subject = await makeEntity(f, "apple-inc", "Apple Inc");
    const objectA = await makeEntity(f, "iphone", "iPhone");
    const objectB = await makeEntity(f, "macbook", "MacBook");

    const factA = await makeFact(f, subject, keep, objectA);
    const factB = await makeFact(f, subject, dup, objectB);

    const moved = await driver.executeQuery(PREDICATE_MERGE_CYPHER, {
      userId: f.userId,
      keepId: keep,
      dupId: dup,
    });
    assert(Number(moved.records[0].get("moved")) === 1, "one fact must be rewired");

    const survivor = (
      await driver.executeQuery(PREDICATE_GET_CYPHER, {
        id: keep,
        userId: f.userId,
      })
    ).records[0];
    assert(
      Number(survivor.get("factCount")) === 2,
      "the survivor must count both facts",
    );
    assert(
      (survivor.get("aliases") as string[]).includes("MADE_BY"),
      "the loser's name must fold into the survivor's aliases",
    );

    const listed = (
      await driver.executeQuery(PREDICATE_LIST_CYPHER, { userId: f.userId })
    ).records.map((record) => String(record.get("id")));
    assert(
      !listed.includes(dup),
      "the merged predicate must be gone from the vocabulary",
    );

    for (const factId of [factA, factB]) {
      const edges = (
        await driver.executeQuery(FACT_EDGES_CYPHER, {
          id: factId,
          userId: f.userId,
        })
      ).records[0];
      assert(
        String(edges.get("predicateId")) === keep,
        "both facts must point at the survivor",
      );
    }
    await cleanup(f);
  });

  // 8 — orphan GC spares an entity a :Memory node still draws. `:Memory` nodes
  // remain in the graph for the view, so ABOUT has to count as a live reference;
  // that stops being true the moment someone simplifies the GC pattern.
  await check("orphan GC spares an entity a :Memory node still draws", async () => {
    const f = await fixture();
    const entity = await makeEntity(f, "apple", "Apple");
    const memoryId = randomUUID();

    // MATCH the entity rather than CREATE it: it already exists, and a CREATE
    // of the same `id` is a uniqueness violation rather than a second node.
    await driver.executeQuery(
      "MATCH (e:Entity {id: $entityId, userId: $userId}) " +
        "CREATE (m:Memory {id: $memoryId, userId: $userId})-[:ABOUT]->(e)",
      { memoryId, userId: f.userId, entityId: entity },
    );

    await driver.executeQuery(buildOrphanGcCypher("Entity"), {
      userId: f.userId,
    });
    const survived = await driver.executeQuery(
      "MATCH (e:Entity {id: $entityId}) RETURN count(e) AS total",
      { entityId: entity },
    );
    assert(
      Number(survived.records[0].get("total")) === 1,
      "the graph view still draws this entity, so the GC must not collect it",
    );

    await driver.executeQuery("MATCH (m:Memory {id: $memoryId}) DETACH DELETE m", {
      memoryId,
    });
    await driver.executeQuery(buildOrphanGcCypher("Entity"), {
      userId: f.userId,
    });
    const collected = await driver.executeQuery(
      "MATCH (e:Entity {id: $entityId}) RETURN count(e) AS total",
      { entityId: entity },
    );
    assert(
      Number(collected.records[0].get("total")) === 0,
      "once nothing points at it, it goes",
    );
    await cleanup(f);
  });

  // 9 — the list pages, newest first. `/memories` reads through this statement
  // and nothing else exercised it, which is how a clause-order error reached a
  // running dev server: Neo4j accepts `ORDER BY`, `SKIP`/`OFFSET` and `LIMIT`
  // only in that order, and writes it as a syntax error rather than a plan.
  await check("the list pages newest-first and honours the offset", async () => {
    const f = await fixture();
    const entity = await makeEntity(f, "apple", "Apple");
    const predicate = await makePredicate(f, "LIKES");

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await makeFact(f, entity, predicate, entity, "Entity", "Entity", `fact ${i}`));
      // `createdAt` is an ISO string and the ordering is lexicographic, so a
      // same-millisecond batch would page in an arbitrary order.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const page = await driver.executeQuery(FACT_LIST_CYPHER, {
      userId: f.userId,
      limit: 2,
      offset: 1,
    });
    const listed = page.records.map((record) => String(record.get("id")));

    // Newest first, then the first one skipped: the middle fact, then the
    // oldest. Written as a slice of the expected order so the paging is what is
    // asserted, not a hard-coded pair of ids.
    const newestFirst = [...ids].reverse();
    const expected = newestFirst.slice(1, 3);

    assert(listed.length === 2, `the page is bounded by the limit, got ${listed.length}`);
    assert(
      listed[0] === expected[0] && listed[1] === expected[1],
      `offset 1 of a newest-first list is [${expected}], got [${listed}]`,
    );
    // The offset has to skip from the *newest* end; skipping the other way would
    // pass the assertion above only by accident of a two-row page.
    assert(!listed.includes(newestFirst[0]), "the offset skips the newest fact");

    await cleanup(f);
  });

  await driver.close();

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll memory checks passed");
}

main().catch(async (error) => {
  console.error(error);
  await driver.close().catch(() => {});
  process.exit(1);
});
