export const MEMORY_VECTOR_INDEX_NAMES = {
  fact: "fact_embedding",
  entity: "entity_embedding",
  predicate: "predicate_embedding",
  capture: "capture_embedding",
} as const;

export const MEMORY_CONSTRAINT_NAMES = {
  userId: "user_id",
  entityId: "entity_id",
  entityUserName: "entity_user_name",
  predicateId: "predicate_id",
  predicateUserName: "predicate_user_name",
  valueId: "value_id",
  factId: "fact_id",
  captureId: "capture_id",
} as const;

/**
 * The schema, as an ordered list of idempotent statements. Pure so it can be
 * unit tested without a server; the dimension is interpolated because
 * `vector.dimensions` is a literal in the index config.
 *
 * No statement here concerns `:Memory`: the fact graph is the only store this
 * schema maintains.
 */
export function buildNeo4jDdl(dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding dimensions: ${dimensions}`);
  }
  return [
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.userId} IF NOT EXISTS
       FOR (u:User) REQUIRE u.id IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.entityId} IF NOT EXISTS
       FOR (e:Entity) REQUIRE e.id IS UNIQUE`,
    // The entity-resolution key *and* the thing that keeps two users' "Acme"
    // from becoming one node. Both matter.
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.entityUserName} IF NOT EXISTS
       FOR (e:Entity) REQUIRE (e.userId, e.normalizedName) IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.predicateId} IF NOT EXISTS
       FOR (p:Predicate) REQUIRE p.id IS UNIQUE`,
    // Same role as the entity key: `normalizePredicate` collapses "PRODUCT_OF"
    // and "product of" to one string, and this is what makes the MERGE that
    // string keys actually dedupe.
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.predicateUserName} IF NOT EXISTS
       FOR (p:Predicate) REQUIRE (p.userId, p.canonicalName) IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.valueId} IF NOT EXISTS
       FOR (v:Value) REQUIRE v.id IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.factId} IF NOT EXISTS
       FOR (f:Fact) REQUIRE f.id IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.captureId} IF NOT EXISTS
       FOR (c:Capture) REQUIRE c.id IS UNIQUE`,
    `CREATE INDEX entity_user IF NOT EXISTS FOR (e:Entity) ON (e.userId)`,
    `CREATE INDEX predicate_user IF NOT EXISTS FOR (p:Predicate) ON (p.userId)`,
    // The seed's in-index WHERE is the restricted grammar — equality and AND
    // only — so it cannot ask for `validTo IS NULL`. `isCurrent` is the
    // denormalization that puts the test where the index can see it, and this
    // index is what makes the filter a seek rather than a scan. The vector index
    // below declares `isCurrent` filterable for the same reason: the seed tests
    // it *inside* the `SEARCH`, and a property the index does not declare is not
    // filterable there — Neo4j answers 22ND3 rather than falling back to a scan.
    `CREATE INDEX fact_user_current IF NOT EXISTS
       FOR (f:Fact) ON (f.userId, f.isCurrent)`,
    // Reconciliation and the listing read a user's facts in creation order.
    `CREATE INDEX fact_user_created IF NOT EXISTS
       FOR (f:Fact) ON (f.userId, f.createdAt)`,
    // The sweep selects pending captures oldest-first; without this it sorts
    // the user's whole capture set on every pass.
    `CREATE INDEX capture_user_created IF NOT EXISTS
       FOR (c:Capture) ON (c.userId, c.createdAt)`,
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.fact} IF NOT EXISTS
       FOR (f:Fact) ON f.embedding
       WITH [f.userId, f.isCurrent]
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: ${dimensions},
         \`vector.similarity_function\`: 'cosine'
       }}`,
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.entity} IF NOT EXISTS
       FOR (e:Entity) ON e.embedding
       WITH [e.userId]
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: ${dimensions},
         \`vector.similarity_function\`: 'cosine'
       }}`,
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.predicate} IF NOT EXISTS
       FOR (p:Predicate) ON p.embedding
       WITH [p.userId]
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: ${dimensions},
         \`vector.similarity_function\`: 'cosine'
       }}`,
    // Captures are seeded too, so a sentence saved one second ago is recallable
    // before any model has looked at it (§8.5).
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.capture} IF NOT EXISTS
       FOR (c:Capture) ON c.embedding
       WITH [c.userId]
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: ${dimensions},
         \`vector.similarity_function\`: 'cosine'
       }}`,
  ];
}

export const MEMORY_SEED_MULTIPLIER = 3;
export const MEMORY_MIN_TOKEN_LENGTH = 3;
export const MEMORY_MAX_CONCEPT_FEATURES = 24;

/**
 * High by design: only near-duplicate entities should collapse.
 *
 * Read on the same scale as the seed floor below — Neo4j reports a cosine
 * index's score as `(1 + cos) / 2`, so 0.9 is a cosine of about 0.8, not 0.9.
 * `ENTITY_NEAREST_CYPHER` compares it inside Cypher.
 */
export const MEMORY_ENTITY_MERGE_THRESHOLD = 0.9;

/**
 * The canonicalization threshold: the similarity at which a surface form is
 * judged to *be* an existing predicate rather than a new one. This single number
 * carries the accuracy of both dedup and recall — too high and "made by" /
 * "product of" coexist, too low and "likes" merges into "loves".
 *
 * Same `(1 + cos) / 2` scale as the seed floor: 0.86 is a cosine of about 0.72.
 *
 * The spec calls this eval-tuned, and §9.3 is the harness that was meant to tune
 * it — **but `pnpm memory:eval` seeds already-resolved entities, predicates and
 * objects, so it never runs canonicalization and cannot move this value.** Until
 * a harness captures sentences through the extractor, treat this as a judgement
 * call rather than a measured one.
 */
export const MEMORY_PREDICATE_MERGE_THRESHOLD = 0.86;

/**
 * The merge sweep's threshold, deliberately *tighter* than the resolve
 * threshold — and on the same `(1 + cos) / 2` scale, so 0.95 is a cosine of
 * about 0.9. Resolving at 0.86 merges things the extractor phrased differently;
 * merging two already-canonical nodes is destructive and irreversible, so it
 * waits for a near-identical pair.
 */
export const MEMORY_PREDICATE_CLUSTER_THRESHOLD = 0.95;

/** How many ranked facts reach the prompt. */
export const MEMORY_FACT_TOP = 5;

/**
 * The similarity a seed must reach to count as a match at all.
 *
 * A vector index always returns its `k` nearest rows, however far away they are,
 * so without a floor every question returns five memories — the unrelated ones
 * crowding the prompt is the failure a user actually notices, and it is the one
 * the eval's precision metric exists to catch.
 *
 * **Read the scale before reading the number.** Neo4j reports a cosine index's
 * score as `(1 + cos) / 2`, not as the cosine: a *fully orthogonal* pair — no
 * relationship at all — scores **0.5**, and the range is [0, 1]. So this floor
 * is not a small number, it is 0.1 above the no-relationship point: it demands a
 * cosine of at least 0.2 before a row counts as a match.
 *
 * Measured against the eval's probe set: the weakest relevant seed scores 0.71
 * and an unrelated question's best seed scores 0.51. The gap is real but narrow,
 * because this embedding model compresses short sentences into a high band. The
 * floor sits at the gap's lower end, because dropping a real memory costs the
 * user more than one irrelevant line does.
 *
 * It is tied to the embedding model: a different one re-scales every number
 * here, and the floor has to be re-measured with `pnpm memory:eval`.
 *
 * Applied to hops-0 candidates only. A fact reached by traversal carries a path
 * instead of a similarity — its vector score is zero by construction — so a
 * floor on it would delete expansion wholesale.
 */
export const MEMORY_SEED_SCORE_FLOOR = 0.6;

/** One page of the memory list. The cap bounds what a single request can pull. */
export const MEMORY_FACT_PAGE_SIZE = 20;
export const MEMORY_FACT_PAGE_MAX = 100;

/** Pending captures seeded alongside facts — the "saved is instantly recallable" arm. */
export const MEMORY_CAPTURE_SEED_LIMIT = 5;

/** After this many failed extractions a capture stops costing a model call. */
export const MEMORY_CAPTURE_MAX_ATTEMPTS = 3;

/** Captures one sweep pass may extract. */
export const MEMORY_CAPTURE_SWEEP_LIMIT = 10;

/**
 * How often the list re-reads while a capture is still pending.
 *
 * Extraction runs after the response, so the response carries no fact and cannot
 * say when one exists — but the read *can* say a capture is outstanding, and
 * that signal ends on its own: the capture leaves the pending set the moment the
 * sweep materializes it, or once its attempts are spent. A poll keyed on it
 * therefore stops without anyone guessing how long an extraction takes, which a
 * fixed window cannot do.
 */
export const MEMORY_CAPTURE_POLL_MS = 1500;

/**
 * The ceiling on that polling. The pending signal already terminates, so this
 * bounds the one case it cannot see: an app whose sweep never runs at all, where
 * the capture would otherwise be pending forever and the tab would poll forever
 * with it.
 */
export const MEMORY_CAPTURE_POLL_MAX_MS = 30_000;

/**
 * The `(subject, predicate)` groups one reconciliation pass reads. Reconciliation
 * is a repair for facts the extractor could not settle, so the bound is on
 * per-pass work rather than on correctness: an unvisited group is simply visited
 * next pass.
 */
export const MEMORY_RECONCILE_LIMIT = 200;

/**
 * Predicates that admit exactly one current object. "works as" is functional —
 * a person has one job — so a new value replaces the old even when the
 * extractor did not say so. "likes" is not, which is exactly why this is an
 * allow-list and not a heuristic.
 *
 * The names are canonical (`normalizePredicate` output), not surface forms.
 */
export const FUNCTIONAL_PREDICATES = [
  "WORKS_AS",
  "WORKS_AT",
  "LIVES_IN",
  "IS_BASED_IN",
  "HAS_NAME",
] as const;

/** The traversal bound: two hops, the depth that reaches fact→entity→fact. */
export const MEMORY_RECALL_HOPS = 2;

/** The per-hop weight decay: a second hop contributes, but less than the first. */
export const MEMORY_TRAVERSAL_DECAY = 0.6;

export const MEMORY_SEED_MIN = 15;

/**
 * Seed similarity outweighs the graph path. A traversal is evidence a fact is
 * related to the question, not evidence that it answers it.
 */
export const MEMORY_WEIGHT_SEED = 0.7;
export const MEMORY_WEIGHT_GRAPH = 0.3;

export const MEMORY_RELATION_TYPES = [
  "ABOUT",
  "RELATES_TO",
  "SUPERSEDES",
  "CONTRADICTS",
] as const;
export type MemoryRelationType = (typeof MEMORY_RELATION_TYPES)[number];

/**
 * The memory→memory edge kinds: every relation type whose two ends are both
 * `:Memory`. Narrower than `MEMORY_RELATION_TYPES`, which also carries `ABOUT`
 * — a memory→entity edge, drawn by `GRAPH_ABOUT_CYPHER` rather than by the
 * memory-edge read that uses this set.
 */
export const MEMORY_LLM_EDGE_TYPES = [
  "RELATES_TO",
  "SUPERSEDES",
  "CONTRADICTS",
] as const satisfies readonly MemoryRelationType[];

/** Dropped by `tokenize`, so a text's features are its content words. */
export const MEMORY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "about",
  "have",
  "will",
  "just",
  "into",
  "than",
  "them",
  "they",
  "their",
  "there",
  "what",
  "when",
  "where",
  "which",
  "while",
  "been",
  "being",
  "does",
  "did",
  "dont",
  "can't",
  "cant",
  "should",
  "could",
  "would",
  "please",
  "user",
]);

export function memorySeedLimit(top: number): number {
  return Math.max(top * MEMORY_SEED_MULTIPLIER, MEMORY_SEED_MIN);
}

/**
 * Bound on the retrieval query string. Lives here rather than in the store so
 * the pure text primitives can read it without importing IO.
 */
export const MEMORY_MAX_QUERY_CHARS = 24_000;

/** Joins the kept head and tail of a truncated retrieval query. */
export const MEMORY_QUERY_SEPARATOR = "\n...\n";

/**
 * How many memories the graph view reads before their entities are added.
 * Separate from `MEMORY_GRAPH_NODE_LIMIT` because the two bound different
 * things: this bounds the traversal's input, that bounds what is drawn.
 */
export const MEMORY_GRAPH_MEMORY_LIMIT = 120;

/**
 * How many current facts the graph read pulls. The ceiling the drawing's size
 * follows from — see `MEMORY_GRAPH_NODE_LIMIT` for what is then drawn.
 */
export const MEMORY_GRAPH_FACT_LIMIT = 1000;

/**
 * The ceiling on total nodes the view draws — facts plus the entities,
 * predicates and values they link.
 *
 * Entities, predicates and values are shared, so this is reached only when facts
 * carry mostly unique satellites. Past it the lowest-degree satellites are
 * dropped and facts never are: a fact is what the reader came for, and its
 * satellites are what connect it to the rest. Ties break by label, then id, so
 * the dropped set is the same on every read.
 */
export const MEMORY_GRAPH_NODE_LIMIT = 3000;

/**
 * Base radius by kind, in world units. Kind is carried by shape and size as well
 * as colour, so each kind starts at a different size; `nodeRadius` grows it with
 * degree up to `MEMORY_GRAPH_MAX_NODE_RADIUS`.
 */
export const MEMORY_GRAPH_NODE_BASE_RADIUS = {
  fact: 3.5,
  entity: 5,
  predicate: 4.5,
  value: 3,
} as const;
export const MEMORY_GRAPH_DEGREE_RADIUS_SCALE = 1.6;
export const MEMORY_GRAPH_MAX_NODE_RADIUS = 20;

/**
 * Layout tuning, and the reason each number is what it is.
 *
 * The forces are Fruchterman–Reingold's, which is what makes the numbers here
 * few: every force is expressed against `k`, the ideal edge length derived from
 * the canvas area and the node count, so there is nothing to retune when the
 * panel is resized. Repulsion is `k²/d` and attraction is `d²/k`; the two cross
 * at exactly `d = k`, so a connected pair settles at the ideal spacing rather
 * than at a distance some constant happened to pick.
 *
 * `LAYOUT_CENTER_PULL` — gravity toward the middle, applied as a fraction of
 * each node's distance from it. It is what keeps a graph of several disconnected
 * components from drifting off-canvas, and it must stay well *below* the
 * repulsion at a typical distance or it collapses the layout to a point: at a
 * distance of `k` repulsion is `k` itself, so a pull of 0.01 is two orders of
 * magnitude weaker. That margin is the whole reason the value looks so small.
 * `LAYOUT_MAX_STEP` — an absolute ceiling on one iteration's movement, on top of
 * the cooling temperature. Repulsion diverges as `d → 0`, so a pair that drifts
 * coincident would otherwise fling both nodes across the canvas in a single
 * step and drag the rest of the graph after them.
 * `LAYOUT_TEMPERATURE_DECAY` — the cooling schedule, from `min(width, height)/10`
 * down to roughly a tenth of that over `LAYOUT_ITERATIONS`. A layout that cools
 * too fast freezes in its seeded spiral; one that never cools oscillates.
 * `LAYOUT_ITERATIONS` — a fixed count rather than a convergence test, because a
 * graph that never fully settles would never terminate the test. 160 is where a
 * graph of the cap size stops visibly moving.
 */
export const MEMORY_GRAPH_LAYOUT_ITERATIONS = 160;
export const MEMORY_GRAPH_LAYOUT_CENTER_PULL = 0.01;
export const MEMORY_GRAPH_LAYOUT_MAX_STEP = 18;
export const MEMORY_GRAPH_LAYOUT_TEMPERATURE_DECAY = 0.985;

/**
 * Bounds on the drawn canvas, in layout units. The simulation runs in its own
 * coordinate space and these give it an area to aim for; React Flow then fits
 * the result to whatever the panel actually is, so these are not pixels and do
 * not need to track the viewport.
 */
export const MEMORY_GRAPH_LAYOUT_WIDTH = 1400;
export const MEMORY_GRAPH_LAYOUT_HEIGHT = 900;

/**
 * Users one sweep pass touches. The worklist is users with something pending
 * rather than every user, so this bounds a drip, not a thundering herd.
 */
export const MEMORY_SWEEP_USER_LIMIT = 50;
