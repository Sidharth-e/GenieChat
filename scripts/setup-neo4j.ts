import neo4j from "neo4j-driver";
import { buildNeo4jDdl, MEMORY_VECTOR_INDEX_NAMES } from "../constants/memory";
import { EMBEDDING_DIMENSIONS } from "../constants/embeddings";

interface VectorIndexRow {
  name: string;
  properties: string[];
  options: Record<string, unknown>;
}

async function main(): Promise<void> {
  const uri = process.env.NEO4J_URI;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !password) {
    console.error(
      "NEO4J_URI and NEO4J_PASSWORD must both be set. Add them to .env before running this.",
    );
    process.exit(1);
  }

  const driver = neo4j.driver(
    uri,
    neo4j.auth.basic(process.env.NEO4J_USER ?? "neo4j", password),
    // Same option the app's driver sets, for the same reason: without it the
    // config integers below come back as boxed `Integer`s and a plain `!==`
    // between two 768s is false. The `Number()` in the comparison keeps the
    // guard correct even if this option ever changes.
    { disableLosslessIntegers: true },
  );

  try {
    // Each DDL statement must run in its own transaction: Neo4j rejects a
    // schema change inside a transaction that has already touched data.
    for (const statement of buildNeo4jDdl(EMBEDDING_DIMENSIONS)) {
      const session = driver.session();
      try {
        await session.run(statement);
        console.log(`ok: ${statement.split("\n")[0].trim()}`);
      } finally {
        await session.close();
      }
    }

    // `IF NOT EXISTS` says nothing about a dimension change: pointing
    // EMBEDDING_DIMENSIONS at a new model leaves an existing index at the old
    // width, every statement above still reports ok, and the mismatch surfaces
    // only later as memories that embed fine and can never match a query. So
    // the live indexes are read back and compared rather than assumed — the
    // same reasoning as setup-postgres.ts's column read-back.
    //
    // The filterable-property check is here for a second silent failure. A
    // server below 2026.02 creates the index without `WITH [...]` and reports
    // success; the SEARCH clause then cannot filter in-index, so it filters
    // only the k rows the index already returned and a small tenant starves.
    // Neither the dimensions nor the filterable property is visible anywhere
    // else in the app, so this is the one place either can be caught.
    const session = driver.session();
    try {
      const { records } = await session.run(
        "SHOW INDEXES YIELD name, type, properties, options WHERE type = 'VECTOR'",
      );
      const rows: VectorIndexRow[] = records.map((record) => ({
        name: record.get("name") as string,
        properties: (record.get("properties") as string[]) ?? [],
        options: (record.get("options") as Record<string, unknown>) ?? {},
      }));

      const problems: string[] = [];
      for (const name of Object.values(MEMORY_VECTOR_INDEX_NAMES)) {
        const row = rows.find((candidate) => candidate.name === name);
        if (!row) {
          problems.push(`${name}: missing`);
          continue;
        }
        const indexConfig = (row.options["indexConfig"] ?? {}) as Record<
          string,
          unknown
        >;
        const dimensions = Number(indexConfig["vector.dimensions"]);
        if (dimensions !== EMBEDDING_DIMENSIONS) {
          problems.push(
            `${name}: vector.dimensions is ${String(dimensions)}, expected ${EMBEDDING_DIMENSIONS}. ` +
              "CREATE INDEX IF NOT EXISTS cannot change an existing index: drop and recreate it.",
          );
        }
        if (!row.properties.includes("userId")) {
          problems.push(
            `${name}: userId is not a filterable property (properties: ${row.properties.join(", ")}). ` +
              "In-index tenant filtering is unavailable on this server, so retrieval will " +
              "starve small tenants — Neo4j 2026.02 or newer is required.",
          );
        }
        console.log(
          `vector index ${name}: dimensions=${dimensions} filterable=${row.properties.filter((p) => p !== "embedding").join(",") || "(none)"}`,
        );
      }

      if (problems.length > 0) {
        for (const problem of problems) console.error(problem);
        process.exit(1);
      }
    } finally {
      await session.close();
    }

    const summary = driver.session();
    try {
      const { records } = await summary.run("SHOW INDEXES YIELD name, type");
      console.log(
        `indexes: ${records.map((r) => `${r.get("name")}(${r.get("type")})`).join(", ")}`,
      );
    } finally {
      await summary.close();
    }
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
