/**
 * Measures recall against the fixed probe set.
 *
 * Not a migration gate — there is no migration. It is the check that recall
 * works before chat is switched onto it.
 *
 * **What it can and cannot tune.** It measures the *read* path, and the two
 * constants that belong to the read path are `MEMORY_SEED_SCORE_FLOOR` and the
 * ranking weights — change one, run this, read the counts. It cannot tune
 * `MEMORY_PREDICATE_MERGE_THRESHOLD` or `MEMORY_ENTITY_MERGE_THRESHOLD`: those
 * are read only by the *write* path's canonicalization (`graph-store.ts`), and
 * this harness seeds its triples with the entity and predicate ids already
 * resolved, precisely so a run is deterministic. Lowering either threshold
 * changes nothing here — verified, not assumed.
 *
 * It drives the **real** pipeline (`lib/memory/pipeline.ts`). If it rebuilt the
 * composition from primitives it would measure its own copy — the same trap
 * `cypher.ts` exists to avoid, and the reason the pipeline was extracted out of
 * the `"server-only"` store in the first place.
 *
 * Four deliberate choices, all of them the same shape as `check-memory.ts`:
 *
 * 1. It reads `process.env` and builds its own driver rather than importing
 *    `@/lib/neo4j/client` or `@/lib/config`: both carry the `"server-only"`
 *    guard, which Next aliases at build time and `tsx` does not resolve at all.
 * 2. It embeds through its own OpenRouter call rather than `@/lib/embeddings`,
 *    which is guarded for the same reason. It reuses that provider's pure
 *    helpers (`normalizeTextForEmbedding`, `truncateByEstimatedTokenBudget`,
 *    `assertEmbeddingDimensions`) so the text sent and the width checked are the
 *    same. Its retry loop is wider than the provider's, and it throws where the
 *    provider returns null — see `embed`.
 * 3. An unconfigured Neo4j or embedding model is a **failure**, not a skip. The
 *    script's whole job is to exercise a live graph, and exiting 0 on an
 *    environment where nothing ran would report success for work that never
 *    happened.
 * 4. Each case gets a throwaway `userId`, so a run never touches a real graph and
 *    a re-run is unaffected by the previous one.
 */
import { randomUUID } from "node:crypto";
import axios from "axios";
import neo4j from "neo4j-driver";
import {
  assertEmbeddingDimensions,
  isEmbeddingDimensionError,
} from "@/lib/embeddings/dimensions";
import {
  normalizeTextForEmbedding,
  truncateByEstimatedTokenBudget,
} from "@/lib/embeddings/text";
import { MEMORY_FACT_TOP } from "@/constants/memory";
import { normalizeEntityName, normalizePredicate } from "@/lib/memory/canonicalize";
import {
  buildFactCreateCypher,
  ENTITY_CREATE_CYPHER,
  FACT_CLOSE_CYPHER,
  PREDICATE_CREATE_CYPHER,
  TEST_GC_CYPHER,
  USER_UPSERT_CYPHER,
} from "@/lib/memory/cypher";
import { MEMORY_EVAL_CASES, type EvalCase } from "@/lib/memory/eval-cases";
import { runRecallPipeline } from "@/lib/memory/pipeline";

const uri = process.env.NEO4J_URI;
const password = process.env.NEO4J_PASSWORD;
const neo4jUser = process.env.NEO4J_USER ?? "neo4j";
const apiKey = process.env.OPENROUTER_API_KEY;
const embeddingModel = process.env.OPENROUTER_EMBEDDING_MODEL;

if (!uri || !password) {
  console.error(
    "NEO4J_URI and NEO4J_PASSWORD must be set. This script reads them from the\n" +
      "environment; the `memory:eval` pnpm script loads `.env` for you.",
  );
  process.exit(1);
}

if (!apiKey || !embeddingModel) {
  console.error(
    "OPENROUTER_API_KEY and OPENROUTER_EMBEDDING_MODEL must be set — recall is a\n" +
      "vector search, so a case that cannot be embedded cannot be scored.",
  );
  process.exit(1);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(neo4jUser, password), {
  disableLosslessIntegers: true,
});

const embeddings = axios.create({
  baseURL: "https://openrouter.ai/api/v1",
  timeout: 60_000,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
});

interface Outcome {
  name: string;
  returned: string[];
  missing: string[];
  tripped: string[];
  precision: number;
}

/**
 * The embedding call, and deliberately **not** the production policy.
 *
 * Production degrades: a failed embed writes the fact vectorless and recall
 * heals it later. Here that would corrupt the fixture — a fact seeded without a
 * vector is invisible to the index, so a throttled endpoint would surface as
 * "the right fact was missing", reporting an infrastructure hiccup as a recall
 * bug. So a persistent failure **throws**, and the case is reported as an error
 * with its cause rather than as a failed assertion.
 *
 * The retry is the provider's own shape (three attempts, doubling backoff),
 * widened because the seeding loop makes several calls in quick succession and
 * the endpoint's limit is per minute: 1s/2s/3s/4s rides out a window that
 * 500ms does not.
 */
async function embed(text: string): Promise<number[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await embeddings.post("/embeddings", {
        model: embeddingModel,
        input: truncateByEstimatedTokenBudget(normalizeTextForEmbedding(text)).trim() || ".",
      });
      const embedding = response.data?.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error(`Embedding response carried no vector for ${JSON.stringify(text)}`);
      }
      assertEmbeddingDimensions(embedding, "eval embedding");
      return embedding;
    } catch (error) {
      if (isEmbeddingDimensionError(error)) throw error;
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(
    `Embedding endpoint unavailable after 5 attempts — the eval measured nothing. ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function seedCase(userId: string, testCase: EvalCase): Promise<void> {
  await driver.executeQuery(USER_UPSERT_CYPHER, {
    userId,
    name: "Eval Fixture",
    email: "eval@example.invalid",
  });

  const entityIds = new Map<string, string>();
  const predicateIds = new Map<string, string>();
  const closedIds: string[] = [];

  /**
   * One node per surface form, memoised so two facts about apple share it.
   *
   * No embedding: recall seeds and traverses over *facts*, and the entity and
   * predicate vectors are read only by the write path's resolution
   * (`ENTITY_NEAREST_CYPHER`, `PREDICATE_NEAREST_CYPHER`), which this script
   * does not run. Asking for them would cost an embedding call per node against
   * an endpoint that throttles, and change nothing that gets measured.
   */
  const entityFor = async (surface: string): Promise<string> => {
    if (surface === "user") return userId;
    const existing = entityIds.get(surface);
    if (existing) return existing;

    const created = await driver.executeQuery(ENTITY_CREATE_CYPHER, {
      id: randomUUID(),
      userId,
      normalizedName: normalizeEntityName(surface),
      name: surface,
      embedding: null,
    });
    const id = String(created.records[0].get("id"));
    entityIds.set(surface, id);
    return id;
  };

  const predicateFor = async (surface: string): Promise<string> => {
    const existing = predicateIds.get(surface);
    if (existing) return existing;

    const created = await driver.executeQuery(PREDICATE_CREATE_CYPHER, {
      id: randomUUID(),
      userId,
      canonicalName: normalizePredicate(surface),
      embedding: null,
    });
    const id = String(created.records[0].get("id"));
    predicateIds.set(surface, id);
    return id;
  };

  for (const fact of testCase.facts) {
    const subjectId = await entityFor(fact.subject);
    const objectId = await entityFor(fact.object);
    const predicateId = await predicateFor(fact.predicate);
    const id = randomUUID();

    await driver.executeQuery(
      buildFactCreateCypher(fact.subject === "user" ? "User" : "Entity", "Entity"),
      {
        id,
        userId,
        subjectId,
        objectId,
        predicateId,
        embedding: await embed(fact.text),
        confidence: 1,
        sourceText: fact.text,
        now: new Date().toISOString(),
      },
    );

    if (fact.current === false) closedIds.push(id);
  }

  if (closedIds.length > 0) {
    await driver.executeQuery(FACT_CLOSE_CYPHER, {
      userId,
      factIds: closedIds,
      now: new Date().toISOString(),
    });
  }
}

function score(testCase: EvalCase, returned: string[]): Outcome {
  const expected = testCase.expect ?? [];
  const haystack = returned.join("\n").toLowerCase();
  const missing = expected.filter((needle) => !haystack.includes(needle.toLowerCase()));
  // The history arm strips the parenthetical before matching, so a fact the
  // design renders as past is not reported as a fact served as current.
  const currentOnly = haystack.replace(/\(previously:[^)]*\)/g, "");
  const tripped = [
    ...(testCase.reject ?? []).filter((needle) => haystack.includes(needle.toLowerCase())),
    ...(testCase.rejectCurrent ?? []).filter((needle) =>
      currentOnly.includes(needle.toLowerCase()),
    ),
  ];
  const hits = expected.length - missing.length;

  // Precision over an empty result is defined rather than divided: returning
  // nothing is perfect when nothing was expected (the prompt was not crowded)
  // and zero when something was (the prompt was empty instead of wrong). The
  // naive `hits / returned.length` is `0/0` — NaN — in the second case, which
  // silently poisons the mean and the summary line.
  const precision =
    returned.length === 0 ? (expected.length === 0 ? 1 : 0) : hits / returned.length;

  return {
    name: testCase.name,
    returned,
    missing,
    tripped,
    precision,
  };
}

async function main(): Promise<void> {
  console.log("Memory recall eval\n");

  const outcomes: Outcome[] = [];

  for (const testCase of MEMORY_EVAL_CASES) {
    const userId = randomUUID();
    try {
      await seedCase(userId, testCase);

      const result = await runRecallPipeline(
        { driver, embed },
        userId,
        testCase.query,
        MEMORY_FACT_TOP,
      );

      const outcome = score(
        testCase,
        result.facts.map((fact) => fact.text),
      );
      outcomes.push(outcome);

      const ok = outcome.missing.length === 0 && outcome.tripped.length === 0;
      console.log(
        `  ${ok ? "ok  " : "FAIL"}  ${outcome.name} — returned ${outcome.returned.length}, ` +
          `precision@k ${outcome.precision.toFixed(2)}, mode ${result.metadata.mode}`,
      );
      for (const miss of outcome.missing) console.log(`        missing: ${miss}`);
      for (const trip of outcome.tripped) console.log(`        should not return: ${trip}`);
    } catch (error) {
      outcomes.push({
        name: testCase.name,
        returned: [],
        missing: testCase.expect ?? [],
        tripped: [],
        precision: 0,
      });
      console.error(`  FAIL  ${testCase.name}`);
      console.error(
        `        ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await driver.executeQuery(TEST_GC_CYPHER, { userId });
      await driver.executeQuery("MATCH (u:User {id: $userId}) DETACH DELETE u", { userId });
    }
  }

  const failed = outcomes.filter(
    (outcome) => outcome.missing.length > 0 || outcome.tripped.length > 0,
  );
  const staleness = outcomes.filter((outcome) => outcome.tripped.length > 0).length;
  const meanPrecision =
    outcomes.reduce((sum, outcome) => sum + outcome.precision, 0) / outcomes.length;

  console.log(
    `\n${outcomes.length} case(s) — mean precision@k ${meanPrecision.toFixed(2)}, ` +
      `staleness ${staleness}, failed ${failed.length}`,
  );

  await driver.close();

  if (failed.length > 0) {
    console.error(`Failed: ${failed.map((outcome) => outcome.name).join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll eval cases passed");
}

main().catch(async (error) => {
  console.error(error);
  await driver.close().catch(() => {});
  process.exit(1);
});
