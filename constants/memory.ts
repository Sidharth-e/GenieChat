export const MEMORY_VECTOR_INDEX_NAMES = {
  memory: "memory_embedding",
  entity: "entity_embedding",
} as const;

export const MEMORY_CONSTRAINT_NAMES = {
  memoryId: "memory_id",
  entityId: "entity_id",
  entityUserName: "entity_user_name",
} as const;

/**
 * The schema, as an ordered list of idempotent statements. Pure so it can be
 * unit tested without a server; the dimension is interpolated because
 * `vector.dimensions` is a literal in the index config.
 */
export function buildNeo4jDdl(dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding dimensions: ${dimensions}`);
  }
  return [
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.memoryId} IF NOT EXISTS
       FOR (m:Memory) REQUIRE m.id IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.entityId} IF NOT EXISTS
       FOR (e:Entity) REQUIRE e.id IS UNIQUE`,
    // The entity-resolution key *and* the thing that keeps two users' "Acme"
    // from becoming one node. Both matter.
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.entityUserName} IF NOT EXISTS
       FOR (e:Entity) REQUIRE (e.userId, e.normalizedName) IS UNIQUE`,
    // The sort key is the point. `EDGE_CANDIDATE_CYPHER` reads
    // `MATCH (other:Memory {userId}) ... ORDER BY other.createdAt DESC LIMIT
    // $limit` on every write, and without `createdAt` in the index Neo4j has to
    // read *and sort* the user's whole memory set before it can take the newest
    // 200 — the write cost then tracks the corpus, not the entity count. A
    // `(userId)`-only index is this index minus the sort key, so it is replaced
    // rather than kept beside it: same prefix, same lookups, extra write cost.
    `CREATE INDEX memory_user_created IF NOT EXISTS
       FOR (m:Memory) ON (m.userId, m.createdAt)`,
    `CREATE INDEX memory_enriched IF NOT EXISTS FOR (m:Memory) ON (m.enrichedAt)`,
    `CREATE INDEX entity_user IF NOT EXISTS FOR (e:Entity) ON (e.userId)`,
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.memory} IF NOT EXISTS
       FOR (m:Memory) ON m.embedding
       WITH [m.userId]
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
