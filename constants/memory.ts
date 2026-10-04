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
    // index is what makes the filter a seek rather than a scan.
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
       WITH [f.userId]
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

/** Carried over from the retired `vector-memory-store.ts`, unchanged. */
export const MEMORY_EDGE_THRESHOLD = 0.2;
export const MEMORY_EDGE_NEIGHBOR_LIMIT = 12;

/**
 * How many existing memories a write scores a new one against when deriving
 * `RELATES_TO`. `MEMORY_EDGE_NEIGHBOR_LIMIT` bounds the edges *kept*; this
 * bounds the candidates considered, and exists because scoring against the whole
 * corpus per write is O(n) — the cost §7.2 claims the deterministic layer does
 * not have.
 *
 * The neighbour read orders by `createdAt DESC` before applying this limit. A
 * bare `LIMIT` over an unordered `MATCH` would take an arbitrary sample, which
 * is the same defect as D1 wearing different clothes: whether two related
 * memories get linked would depend on the order the store happened to return
 * them in.
 */
export const MEMORY_EDGE_CANDIDATE_LIMIT = 200;

export const MEMORY_SEED_MULTIPLIER = 3;
export const MEMORY_MIN_TOKEN_LENGTH = 3;
export const MEMORY_MAX_CONCEPT_FEATURES = 24;

/** New. High by design: only near-duplicate entities should collapse. */
export const MEMORY_ENTITY_MERGE_THRESHOLD = 0.9;

/**
 * The canonicalization threshold: the cosine at which a surface form is judged
 * to *be* an existing predicate rather than a new one. This single number
 * carries the accuracy of both dedup and recall — too high and "made by" /
 * "product of" coexist, too low and "likes" merges into "loves". Tuned only by
 * the eval set (`pnpm memory:eval`), never by taste.
 */
export const MEMORY_PREDICATE_MERGE_THRESHOLD = 0.86;

/**
 * The merge sweep's threshold, deliberately *tighter* than the resolve
 * threshold. Resolving at 0.86 merges things the extractor phrased differently;
 * merging two already-canonical nodes is destructive and irreversible, so it
 * waits for a near-identical pair.
 */
export const MEMORY_PREDICATE_CLUSTER_THRESHOLD = 0.95;

/** How many ranked facts reach the prompt. */
export const MEMORY_FACT_TOP = 5;

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

/** Parity with the old GRAPH_SECOND_HOP_LIMIT: two hops, as today. */
export const MEMORY_RECALL_HOPS = 2;

/** Replaces the two hard-coded hop decays that were fused into the old blend. */
export const MEMORY_TRAVERSAL_DECAY = 0.6;

export const MEMORY_SEED_MIN = 15;

/**
 * The seed similarity and the graph path are the two things worth weighting,
 * now that the edges are real rather than heuristic. This replaces the retired
 * five-way blend, which fused scores that only existed because the graph was a
 * guess.
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
 * The memory→memory edge types a model is permitted to write back. Deliberately
 * narrower than `MEMORY_RELATION_TYPES`: `ABOUT` is memory→entity and is written
 * by the deterministic layer, so a model emitting one would be asserting a
 * relationship to an entity it was never shown.
 *
 * Default-closed — adding a relation type does not grant the model write
 * access to it; it has to be named here as well. The `satisfies` clause is the
 * guard in the other direction: naming a type that is not in
 * `MEMORY_RELATION_TYPES` is a build error rather than an edge the store
 * rejects at runtime.
 */
export const MEMORY_LLM_EDGE_TYPES = [
  "RELATES_TO",
  "SUPERSEDES",
  "CONTRADICTS",
] as const satisfies readonly MemoryRelationType[];

export type MemoryLlmEdgeType = (typeof MEMORY_LLM_EDGE_TYPES)[number];

/**
 * The four types the graph walk is allowed to traverse. Kept as a Set so the
 * Cypher parameter is built from one source.
 */
export const MEMORY_TRAVERSABLE_TYPES: string[] = [...MEMORY_RELATION_TYPES];

/**
 * Every edge type the graph view can draw: the four relation types, plus
 * `RELATION`, which is the entity→entity carrier and deliberately lives outside
 * `MEMORY_RELATION_TYPES` (see `RELATION_CYPHER` — it holds its type as a
 * property, not as the type itself).
 */
export const MEMORY_GRAPH_EDGE_KINDS = [
  ...MEMORY_RELATION_TYPES,
  "RELATION",
] as const;
export type MemoryGraphEdgeKind = (typeof MEMORY_GRAPH_EDGE_KINDS)[number];

/** Carried over verbatim from the retired `vector-memory-store.ts`. */
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

/**
 * Filler an entity extraction must not name: function words, light verbs, and
 * the generic nouns that name a slot rather than a thing.
 *
 * Deliberately *not* merged into `MEMORY_STOPWORDS`, even where the two
 * overlap. That set also feeds `tokenize`, which feeds `relationScore`, so
 * adding `are` or `want` to it would silently change edge scoring as well as
 * entity naming — one edit, two unrelated consequences. Two jobs, two lists.
 *
 * Only words of at least `MEMORY_MIN_TOKEN_LENGTH` are listed: `tokenize` has
 * already dropped anything shorter by the time this is consulted.
 */
export const ENTITY_COMMON_WORDS = new Set([
  // Copulas and auxiliaries.
  "are",
  "was",
  "were",
  "can",
  "could",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "would",
  "doing",
  "had",
  "having",
  // Light verbs: a sentence's shape, not its subject. Grouped by lemma, so a
  // list that carries `wants` but not `want` is visible as a gap rather than
  // reading as complete.
  "get",
  "gets",
  "getting",
  "got",
  "give",
  "gives",
  "gave",
  "given",
  "goes",
  "going",
  "gone",
  "went",
  "know",
  "knows",
  "knew",
  "known",
  "like",
  "likes",
  "liked",
  "look",
  "looks",
  "looked",
  "make",
  "makes",
  "made",
  "making",
  "need",
  "needs",
  "needed",
  "say",
  "says",
  "said",
  "see",
  "sees",
  "saw",
  "seen",
  "take",
  "takes",
  "took",
  "taken",
  "think",
  "thinks",
  "thought",
  "use",
  "uses",
  "used",
  "using",
  "want",
  "wants",
  "wanted",
  // Quantifiers, degree, and discourse.
  "all",
  "also",
  "any",
  "even",
  "every",
  "many",
  "more",
  "most",
  "much",
  "now",
  "only",
  "really",
  "some",
  "still",
  "then",
  "too",
  "very",
  "yes",
  // Generic nouns.
  "anybody",
  "anything",
  "everyone",
  "everything",
  "guy",
  "guys",
  "kind",
  "lot",
  "nobody",
  "nothing",
  "one",
  "people",
  "person",
  "somebody",
  "something",
  "sort",
  "stuff",
  "thing",
  "things",
  "way",
  "ways",
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
 * The ceiling on *total* nodes the graph view renders — memories plus entities.
 *
 * It exists because `layoutMemoryGraph` is O(n²) per iteration, so the layout
 * cost tracks the square of whatever this allows. Entities are ranked by how
 * many of the kept memories link them, so a cap drops the least-connected
 * ones rather than an arbitrary slice. Memories are never dropped here: the
 * read cap above already chose them, newest first.
 *
 * 150 is a wall-clock bound, not an aesthetic one. The layout runs
 * synchronously when the view renders, so this is what keeps a graph of the cap
 * size inside a frame or two (~1.8M pair-iterations) instead of the second a
 * 300-node graph takes. Raising it means moving the layout off the render path
 * first — a worker or a chunked loop — because a synchronous second is a frozen
 * tab.
 */
export const MEMORY_GRAPH_NODE_LIMIT = 150;

/**
 * Drawn sizes, in layout units, and therefore also what the simulation is told
 * a node's radius is. They live here rather than in the component because
 * `layoutMemoryGraph` and the renderer have to agree: a node the layout thinks
 * is a pill and the view draws as a card sits on top of its neighbours.
 */
export const MEMORY_GRAPH_MEMORY_NODE_SIZE = { width: 176, height: 64 } as const;
export const MEMORY_GRAPH_ENTITY_NODE_SIZE = { width: 112, height: 28 } as const;

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
