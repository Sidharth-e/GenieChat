import { Pool } from "pg";
import {
  KNOWLEDGE_SEARCH_SQL,
  KNOWLEDGE_TABLE,
  RRF_K,
} from "../constants/knowledge";
import { chunkDocumentWithOverlap } from "../lib/knowledge/chunking";
import { combineRrf } from "../lib/knowledge/ranking";

const OWNER_TYPE = "agent";
const OWNER_ID = "__knowledge_check__";
const CANDIDATE_LIMIT = 20;

const failures: string[] = [];

function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok" : "FAIL"}: ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

/** A 768-dim unit vector, so cosine distance to it is exact and predictable. */
function axis(dimension: number): string {
  const values = Array.from({ length: 768 }, (_, i) => (i === dimension ? 1 : 0));
  return `[${values.join(",")}]`;
}

interface SearchRow {
  id: string;
  content: string;
  vrank: string | null;
  lrank: string | null;
}

async function search(
  pool: Pool,
  vectorLiteral: string | null,
  queryText: string,
): Promise<SearchRow[]> {
  const { rows } = await pool.query<SearchRow>(KNOWLEDGE_SEARCH_SQL, [
    vectorLiteral,
    OWNER_TYPE,
    OWNER_ID,
    CANDIDATE_LIMIT,
    queryText,
  ]);
  return rows;
}

function rankLists(rows: SearchRow[]): { vector: string[]; lexical: string[] } {
  return {
    vector: rows
      .filter((r) => r.vrank !== null)
      .sort((a, b) => Number(a.vrank) - Number(b.vrank))
      .map((r) => r.id),
    lexical: rows
      .filter((r) => r.lrank !== null)
      .sort((a, b) => Number(a.lrank) - Number(b.lrank))
      .map((r) => r.id),
  };
}

async function insert(
  pool: Pool,
  id: string,
  content: string,
  embedding: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${KNOWLEDGE_TABLE}
       (id, owner_type, owner_id, user_id, source_id, title, chunk_index, content, embedding)
     VALUES ($1, $2, $3, 'u-check', 'doc-check', 'check.pdf', 0, $4, $5::vector)`,
    [id, OWNER_TYPE, OWNER_ID, content, embedding],
  );
}

async function main(): Promise<void> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL is not set. Add it to .env before running this.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const cleanup = () =>
    pool.query(`DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_id = $1`, [OWNER_ID]);

  try {
    await cleanup();

    // A: reachable by both arms (has a vector, contains the term).
    // B: lexical-only (no vector) but a higher ts_rank than A.
    // C: vector-only (has a vector, contains no searchable term).
    await insert(pool, "A", "pension alpha", axis(0));
    await insert(pool, "B", "pension pension pension beta", null);
    await insert(pool, "C", "zebra", axis(1));

    // 1. tsquery metacharacters must not raise a syntax error.
    let metaRows: SearchRow[] | null = null;
    let metaError: string | null = null;
    try {
      metaRows = await search(pool, null, "what about (pensions & 401k)? *");
    } catch (error) {
      metaError = error instanceof Error ? error.message : String(error);
    }
    report(
      "metacharacter query is accepted",
      metaError === null && metaRows !== null,
      metaError ?? `returned ${metaRows?.length ?? 0} rows with no syntax error`,
    );

    // 2. The lexical arm finds the chunk holding a distinctive term.
    const lexical = await search(pool, null, "pension");
    const lexicalIds = rankLists(lexical).lexical;
    report(
      "lexical query returns the matching chunk",
      lexicalIds.includes("B") && lexicalIds.includes("A") && !lexicalIds.includes("C"),
      `lexical ranks ${lexicalIds.join(",") || "(none)"}`,
    );

    // 3. The vector arm returns the nearest chunk by cosine distance.
    const vectorRows = await search(pool, axis(0), "zzzznomatch");
    const vectorIds = rankLists(vectorRows).vector;
    report(
      "vector query returns the nearest chunk",
      vectorIds[0] === "A" && vectorIds.includes("C") && !vectorIds.includes("B"),
      `vector ranks ${vectorIds.join(",") || "(none)"}`,
    );

    // 4. Fusion puts a both-arms chunk above a single-arm chunk.
    const both = await search(pool, axis(0), "pension");
    const lists = rankLists(both);
    const fused = combineRrf([lists.vector, lists.lexical], RRF_K);
    const fusedIds = fused.map((h) => h.id);
    report(
      "fusion ranks a both-arms chunk first",
      fusedIds[0] === "A" && fusedIds.includes("B") && fusedIds.includes("C"),
      `fused order ${fusedIds.join(",")}`,
    );

    // 5. Re-running the writer's replace sequence must not double the rows.
    const beforeCount = await pool.query(
      `SELECT count(*)::int AS n FROM ${KNOWLEDGE_TABLE} WHERE owner_id = $1`,
      [OWNER_ID],
    );
    const replaceSequence = async () => {
      await pool.query(
        `DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_type = $1 AND owner_id = $2`,
        [OWNER_TYPE, OWNER_ID],
      );
      await insert(pool, "A", "pension alpha", axis(0));
    };
    await replaceSequence();
    await replaceSequence();
    const afterReplace = await pool.query(
      `SELECT count(*)::int AS n FROM ${KNOWLEDGE_TABLE} WHERE owner_id = $1`,
      [OWNER_ID],
    );
    report(
      "replace sequence does not double rows",
      afterReplace.rows[0].n === 1 && beforeCount.rows[0].n > 1,
      `${beforeCount.rows[0].n} rows -> ${afterReplace.rows[0].n} after two replace runs`,
    );

    // 6. The owner-scoped delete removes everything for that owner.
    await insert(pool, "B2", "pension beta", null);
    await insert(pool, "C2", "zebra", axis(1));
    const deleted = await pool.query(
      `DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_type = $1 AND owner_id = $2`,
      [OWNER_TYPE, OWNER_ID],
    );
    const remaining = await pool.query(
      `SELECT count(*)::int AS n FROM ${KNOWLEDGE_TABLE} WHERE owner_id = $1`,
      [OWNER_ID],
    );
    report(
      "owner-scoped delete clears every row",
      (deleted.rowCount ?? 0) > 0 && remaining.rows[0].n === 0,
      `deleted ${deleted.rowCount}, ${remaining.rows[0].n} remain`,
    );

    // 7. A punctuation-only chunk must insert and yield an empty tsvector.
    await insert(pool, "P", "!!! ??? *** ...", null);
    const punctuation = await pool.query(
      `SELECT content_tsv = ''::tsvector AS empty FROM ${KNOWLEDGE_TABLE} WHERE id = 'P'`,
    );
    report(
      "punctuation-only chunk yields an empty tsvector",
      punctuation.rows[0]?.empty === true,
      `content_tsv empty = ${punctuation.rows[0]?.empty}`,
    );

    // 8. Indexing zero chunks is a valid clear, not an error.
    await insert(pool, "Z", "leftover", null);
    const chunks = chunkDocumentWithOverlap("");
    const zeroChunks = chunks.length === 0;
    if (zeroChunks) {
      await pool.query(
        `DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_type = $1 AND owner_id = $2`,
        [OWNER_TYPE, OWNER_ID],
      );
    }
    const afterZero = await pool.query(
      `SELECT count(*)::int AS n FROM ${KNOWLEDGE_TABLE} WHERE owner_id = $1`,
      [OWNER_ID],
    );
    report(
      "zero chunks clears the owner without throwing",
      zeroChunks && afterZero.rows[0].n === 0,
      `chunkDocumentWithOverlap("") -> ${chunks.length} chunks, ${afterZero.rows[0].n} rows remain`,
    );

    // 9. A failed query embedding must empty the vector arm. Without the
    //    `$1::vector IS NOT NULL` guard the arm returns every embedded row with
    //    a plausible ROW_NUMBER, and this returns rows instead of none.
    await insert(pool, "A", "pension alpha", axis(0));
    const degraded = await search(pool, null, "zzzznomatch");
    report(
      "null query vector empties the vector arm",
      degraded.length === 0,
      `returned ${degraded.length} rows when the query embedding failed`,
    );
  } finally {
    await cleanup();
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
