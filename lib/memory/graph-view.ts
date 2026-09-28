/**
 * Turns the four graph reads into the node-and-edge set the view draws.
 *
 * Pure, and deliberately unaware of React Flow: the rows Neo4j returns and the
 * shape a renderer wants are different concerns, and keeping the mapping here
 * means the interesting decisions — which entities survive the cap, what an
 * edge is called, what "degree" means — are unit-testable without a browser.
 *
 * It is also the only place the tenant boundary is *not* enforced. That is
 * correct: the queries in `cypher.ts` already filter on `userId`, and a second
 * check here would be checking rows this module has no way to authenticate.
 */
import {
  MEMORY_GRAPH_EDGE_KINDS,
  MEMORY_GRAPH_NODE_LIMIT,
  MEMORY_LLM_EDGE_TYPES,
  type MemoryGraphEdgeKind,
} from "@/constants/memory";

/** The `:Memory` row `GRAPH_MEMORIES_CYPHER` returns. */
export interface MemoryGraphMemoryRow {
  id: string;
  content: string;
  createdAt: string;
}

/** One `:ABOUT` edge, from `GRAPH_ABOUT_CYPHER`. */
export interface MemoryGraphAboutRow {
  memoryId: string;
  entityId: string;
  entityName: string | null;
  normalizedName: string | null;
}

/** One memory→memory edge, from `GRAPH_MEMORY_EDGES_CYPHER`. */
export interface MemoryGraphMemoryEdgeRow {
  source: string;
  target: string;
  type: string;
  weight: number | null;
  reason: string | null;
}

/** One entity→entity `:RELATION`, from `GRAPH_ENTITY_RELATIONS_CYPHER`. */
export interface MemoryGraphRelationRow {
  source: string;
  target: string;
  relationType: string | null;
}

export interface MemoryGraphRows {
  memories: MemoryGraphMemoryRow[];
  about: MemoryGraphAboutRow[];
  memoryEdges: MemoryGraphMemoryEdgeRow[];
  entityRelations: MemoryGraphRelationRow[];
}

export interface MemoryGraphViewNode {
  id: string;
  kind: "memory" | "entity";
  /** The text drawn on the node. */
  label: string;
  /** The hover card's body: the full memory text, or the entity's name again. */
  detail: string;
  createdAt: string | null;
  /**
   * Incident edges *as drawn*. Not the node's degree in Neo4j: an edge whose
   * other endpoint fell outside the window is not drawn, and counting it would
   * size a node by connections the reader cannot see.
   */
  degree: number;
}

export interface MemoryGraphViewEdge {
  id: string;
  source: string;
  target: string;
  kind: MemoryGraphEdgeKind;
  /** What the tooltip and legend call this edge. */
  label: string;
  weight: number | null;
  reason: string | null;
}

export interface MemoryGraphView {
  nodes: MemoryGraphViewNode[];
  edges: MemoryGraphViewEdge[];
  /** Memories the store holds, before the read cap. */
  totalMemories: number;
  /** True when a cap dropped something, so the UI can say so rather than lie. */
  truncated: boolean;
}

/**
 * What every edge kind is called, in one place.
 *
 * Exported because the legend on the canvas is what lets a reader decode the
 * picture, and the tooltip names the same edge. A second copy of these strings
 * in the component would mean the legend could disagree with the tooltip about
 * the very edge the reader is pointing at — which makes the legend worse than
 * useless.
 */
export const MEMORY_EDGE_LABELS: Record<MemoryGraphEdgeKind, string> = {
  ABOUT: "mentions",
  RELATES_TO: "relates to",
  SUPERSEDES: "supersedes",
  CONTRADICTS: "contradicts",
  RELATION: "related",
};

const MEMORY_EDGE_TYPES = new Set<string>(MEMORY_LLM_EDGE_TYPES);
const KNOWN_EDGE_KINDS = new Set<string>(MEMORY_GRAPH_EDGE_KINDS);

/**
 * `type(r)` arrives as a plain string, and a relationship type this build has
 * never heard of must not become a rendered edge with an undefined style. The
 * permitted set is closed for the same reason `MEMORY_LLM_EDGE_TYPES` is.
 */
function toEdgeKind(type: string): MemoryGraphEdgeKind | null {
  return KNOWN_EDGE_KINDS.has(type) ? (type as MemoryGraphEdgeKind) : null;
}

/**
 * Builds the drawn graph. Deterministic: the same rows always produce the same
 * node order, which is what lets `layoutMemoryGraph` be reproducible.
 *
 * The cap is applied to entities only, and entities are ranked by how many kept
 * memories link them — so a cap drops the concepts mentioned once, not an
 * arbitrary slice. Memories are the thing the reader came for; the entities are
 * the connective tissue between them.
 */
export function buildMemoryGraphView(
  rows: MemoryGraphRows,
  totalMemories: number,
  nodeLimit: number = MEMORY_GRAPH_NODE_LIMIT,
): MemoryGraphView {
  let truncated = totalMemories > rows.memories.length;

  // Newest first, as the query ordered them, then cut to the node ceiling. A
  // limit below the memory count would otherwise draw more memory nodes than
  // the cap allows.
  const memories =
    rows.memories.length > nodeLimit ? rows.memories.slice(0, nodeLimit) : rows.memories;
  if (memories.length < rows.memories.length) truncated = true;
  const memoryIds = new Set(memories.map((memory) => memory.id));

  // Entities, counted by how many *kept* memories mention them. An ABOUT row
  // naming a memory outside the window is dropped here rather than later, so
  // the ranking counts links that will actually be drawn.
  const entities = new Map<
    string,
    { name: string; normalizedName: string; links: number }
  >();
  for (const row of rows.about) {
    if (!memoryIds.has(row.memoryId)) continue;
    if (!row.entityId) continue;
    const existing = entities.get(row.entityId);
    const name = row.entityName ?? row.normalizedName ?? "";
    if (existing) {
      existing.links += 1;
      continue;
    }
    entities.set(row.entityId, {
      name,
      normalizedName: row.normalizedName ?? name,
      links: 1,
    });
  }

  const entityBudget = Math.max(nodeLimit - memories.length, 0);
  const rankedEntities = [...entities.entries()].sort((a, b) => {
    if (b[1].links !== a[1].links) return b[1].links - a[1].links;
    // Tie-broken by name so the cut is stable between runs rather than
    // depending on Map insertion order.
    return a[1].normalizedName.localeCompare(b[1].normalizedName);
  });
  const keptEntities = rankedEntities.slice(0, entityBudget);
  if (keptEntities.length < rankedEntities.length) truncated = true;
  const entityIds = new Set(keptEntities.map(([id]) => id));

  const edges: MemoryGraphViewEdge[] = [];

  for (const row of rows.about) {
    if (!memoryIds.has(row.memoryId) || !entityIds.has(row.entityId)) continue;
    edges.push({
      id: `about:${row.memoryId}:${row.entityId}`,
      source: row.memoryId,
      target: row.entityId,
      kind: "ABOUT",
      label: MEMORY_EDGE_LABELS.ABOUT,
      weight: null,
      reason: null,
    });
  }

  for (const row of rows.memoryEdges) {
    if (!memoryIds.has(row.source) || !memoryIds.has(row.target)) continue;
    if (!MEMORY_EDGE_TYPES.has(row.type)) continue;
    const kind = toEdgeKind(row.type);
    if (!kind) continue;
    edges.push({
      id: `memory:${row.source}:${row.target}:${row.type}`,
      source: row.source,
      target: row.target,
      kind,
      label: MEMORY_EDGE_LABELS[kind],
      weight: row.weight,
      reason: row.reason,
    });
  }

  for (const row of rows.entityRelations) {
    if (!entityIds.has(row.source) || !entityIds.has(row.target)) continue;
    edges.push({
      id: `relation:${row.source}:${row.target}:${row.relationType ?? ""}`,
      source: row.source,
      target: row.target,
      kind: "RELATION",
      // The relation's own name, not the generic one: the model wrote
      // `employs`, and replacing that with "related" throws away the only
      // information this edge carries.
      label: row.relationType ?? MEMORY_EDGE_LABELS.RELATION,
      weight: null,
      reason: null,
    });
  }

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const nodes: MemoryGraphViewNode[] = [
    ...memories.map((memory) => ({
      id: memory.id,
      kind: "memory" as const,
      label: memory.content,
      detail: memory.content,
      createdAt: memory.createdAt,
      degree: degree.get(memory.id) ?? 0,
    })),
    ...keptEntities.map(([id, entity]) => ({
      id,
      kind: "entity" as const,
      label: entity.normalizedName,
      detail: entity.name,
      createdAt: null,
      degree: degree.get(id) ?? 0,
    })),
  ];

  return { nodes, edges, totalMemories, truncated };
}

/**
 * Applies the search box to a built view.
 *
 * Filtering the *view* rather than re-querying it means searching never costs a
 * Neo4j round trip, and — more importantly — the result is always a subgraph of
 * what was already on screen. A server-side search would return memories whose
 * neighbours were never fetched, so the same search would show a different
 * graph depending on which route produced it.
 *
 * An edge survives only if both its endpoints do; a half-visible edge is not
 * a thing the reader can interpret.
 */
export function filterMemoryGraphView(
  view: MemoryGraphView,
  query: string,
): MemoryGraphView {
  const needle = query.trim().toLowerCase();
  if (!needle) return view;

  const kept = new Set(
    view.nodes
      .filter((node) => {
        // An entity also matches on its display name, which differs from the
        // normalized key the label shows whenever the name had punctuation.
        if (node.label.toLowerCase().includes(needle)) return true;
        return node.kind === "entity" && node.detail.toLowerCase().includes(needle);
      })
      .map((node) => node.id),
  );

  const edges = view.edges.filter(
    (edge) => kept.has(edge.source) && kept.has(edge.target),
  );

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  return {
    nodes: view.nodes
      .filter((node) => kept.has(node.id))
      .map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
    edges,
    totalMemories: view.totalMemories,
    // Inherited, not recomputed: truncation is a fact about what was *read*,
    // and filtering the result down cannot un-truncate it.
    truncated: view.truncated,
  };
}
