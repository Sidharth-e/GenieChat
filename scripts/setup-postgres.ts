import { Pool } from "pg";
import { buildKnowledgeDdl } from "../constants/knowledge";
import { EMBEDDING_DIMENSIONS } from "../constants/embeddings";

async function main(): Promise<void> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL is not set. Add it to .env before running this.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    for (const statement of buildKnowledgeDdl(EMBEDDING_DIMENSIONS)) {
      await pool.query(statement);
      console.log(`ok: ${statement.split("\n")[0].trim()}`);
    }
    // `CREATE TABLE IF NOT EXISTS` says nothing about a width change: pointing
    // EMBEDDING_DIMENSIONS at a new model leaves an existing column at the old
    // width, every statement above still reports ok, and the mismatch surfaces
    // only later as chunks that embed fine and can never match a query. So the
    // live column is read back and compared rather than assumed.
    const { rows: widthRows } = await pool.query<{ column_type: string }>(
      `SELECT format_type(atttypid, atttypmod) AS column_type
         FROM pg_attribute
        WHERE attrelid = 'knowledge_chunks'::regclass
          AND attname = 'embedding'`,
    );
    const expected =
      EMBEDDING_DIMENSIONS > 2000
        ? `halfvec(${EMBEDDING_DIMENSIONS})`
        : `vector(${EMBEDDING_DIMENSIONS})`;
    const actual = widthRows[0]?.column_type;
    if (actual !== expected) {
      console.error(
        `knowledge_chunks.embedding is ${actual ?? "(missing)"}, expected ${expected}. ` +
          "CREATE TABLE IF NOT EXISTS cannot change an existing column: drop the table " +
          "or ALTER the column, then re-run `pnpm knowledge:backfill`.",
      );
      process.exit(1);
    }
    console.log(`knowledge_chunks.embedding: ${actual}`);

    const { rows } = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'knowledge_chunks' ORDER BY indexname",
    );
    console.log(
      `knowledge_chunks indexes: ${rows.map((r) => r.indexname).join(", ")}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
