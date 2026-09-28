import { Pool } from "pg";
import { buildKnowledgeDdl } from "../constants/knowledge";

const EMBEDDING_DIMENSIONS = 768;

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
