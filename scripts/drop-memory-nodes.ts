/**
 * One-off operator script: remove every `:Memory` node, and the index and
 * constraint that served them.
 *
 * It is a script rather than a build step because it is destructive and
 * irreversible — it deletes every user's memories, and nothing converted them,
 * so the fact graph cannot restore them. Run it once, after chat reads the fact
 * graph.
 *
 * Refuses to run without `--yes`.
 *
 * Three deliberate choices, all of them the shape `check-memory.ts` documents:
 *
 * 1. It reads `process.env` and builds its own driver rather than importing
 *    `@/lib/neo4j/client` or `@/lib/config`: both carry the `"server-only"`
 *    guard, which Next aliases at build time and `tsx` does not resolve at all.
 * 2. It imports the orphan GC from `@/lib/memory/cypher` — a module with no
 *    guard — so this script collects orphans with the same statement the sweep
 *    does rather than a copy of it.
 * 3. It reads the live schema names before dropping anything, so a name that is
 *    already gone is a skip rather than a failed run. That is what makes a
 *    second run safe on a graph the first one already cleaned.
 */
import neo4j from "neo4j-driver";
import { buildOrphanGcCypher } from "@/lib/memory/cypher";

/** The prose era's schema. `buildNeo4jDdl` no longer creates either name. */
const PROSE_INDEX_NAMES = ["memory_embedding"];
const PROSE_CONSTRAINT_NAMES = ["memoryId"];

/** The labels `buildOrphanGcCypher` collects. */
const ORPHAN_LABELS = ["Entity", "Value", "Predicate"] as const;

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    console.error(
      "This deletes every :Memory node for every user, permanently, and nothing\n" +
        "converted them — the fact graph cannot restore them.\n" +
        "Re-run with --yes to confirm.",
    );
    process.exit(1);
  }

  const uri = process.env.NEO4J_URI;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !password) {
    console.error(
      "NEO4J_URI and NEO4J_PASSWORD must both be set. This script reads them from\n" +
        "the environment; the `memory:drop-prose` pnpm script loads `.env` for you.",
    );
    process.exit(1);
  }

  const driver = neo4j.driver(
    uri,
    neo4j.auth.basic(process.env.NEO4J_USER ?? "neo4j", password),
    { disableLosslessIntegers: true },
  );

  try {
    /**
     * Read before the delete. `buildOrphanGcCypher` is scoped by `userId`, and
     * once the `:Memory` nodes are gone there is nothing left to read the
     * owners from.
     */
    const owners = (
      await driver.executeQuery("MATCH (m:Memory) RETURN DISTINCT m.userId AS userId")
    ).records.map((record) => String(record.get("userId")));

    const indexNames = (
      await driver.executeQuery("SHOW INDEXES YIELD name")
    ).records.map((record) => String(record.get("name")));
    const constraintNames = (
      await driver.executeQuery("SHOW CONSTRAINTS YIELD name")
    ).records.map((record) => String(record.get("name")));

    for (const name of PROSE_INDEX_NAMES) {
      if (!indexNames.includes(name)) {
        console.log(`index ${name}: already gone`);
        continue;
      }
      await driver.executeQuery(`DROP INDEX \`${name}\``);
      console.log(`index ${name}: dropped`);
    }

    for (const name of PROSE_CONSTRAINT_NAMES) {
      if (!constraintNames.includes(name)) {
        console.log(`constraint ${name}: already gone`);
        continue;
      }
      await driver.executeQuery(`DROP CONSTRAINT \`${name}\``);
      console.log(`constraint ${name}: dropped`);
    }

    const memories = Number(
      (
        await driver.executeQuery("MATCH (m:Memory) RETURN count(m) AS n")
      ).records[0].get("n"),
    );
    if (memories > 0) {
      await driver.executeQuery("MATCH (m:Memory) DETACH DELETE m");
    }
    console.log(`:Memory nodes deleted: ${memories}`);

    // Second, and only second. `buildOrphanGcCypher` treats `ABOUT` as a live
    // reference, so collecting before the delete would spare exactly the
    // entities this is here to collect.
    for (const userId of owners) {
      for (const label of ORPHAN_LABELS) {
        await driver.executeQuery(buildOrphanGcCypher(label), { userId });
      }
    }
    console.log(`orphan GC: ran for ${owners.length} owner(s)`);

    console.log("\nProse era dropped.");
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
