/**
 * Turns one flat read of current facts into the node-and-edge set the view
 * draws.
 *
 * Pure, and deliberately unaware of any renderer: the rows Neo4j returns and the
 * shape a drawing wants are different concerns, and keeping the mapping here
 * means the interesting decisions — which nodes survive the cap, what a node is
 * called, what "degree" means — are unit-testable without a browser.
 *
 * A fact is the hub of its own star: one subject link, one predicate link, one
 * object link. The satellites are what connect facts to each other, because
 * `:Entity`, `:Predicate` and `:Value` are all MERGEd and therefore shared — the
 * clustering the drawing shows is in the data, not computed here.
 *
 * It is also the only place the tenant boundary is *not* enforced. That is
 * correct: the query in `cypher.ts` already filters on `userId`, and a second
 * check here would be checking rows this module has no way to authenticate.
 */
import {
  MEMORY_GRAPH_NODE_BASE_RADIUS,
  MEMORY_GRAPH_DEGREE_RADIUS_SCALE,
  MEMORY_GRAPH_MAX_NODE_RADIUS,
  MEMORY_GRAPH_NODE_LIMIT,
} from "@/constants/memory";

/** One row per fact, from `GRAPH_FACTS_CYPHER`, with its three satellites flattened. */
export interface MemoryGraphFactRow {
  factId: string;
  text: string;
  createdAt: string;
  subjectId: string | null;
  /** The Neo4j label of the subject node, or null when the fact has none. */
  subjectKind: string | null;
  subjectName: string | null;
  predicateId: string | null;
  predicateName: string | null;
  objectId: string | null;
  /** The Neo4j label of the object node: `Entity` or `Value`. */
  objectKind: string | null;
  objectName: string | null;
}

export type MemoryGraphNodeKind = "fact" | "entity" | "predicate" | "value";

export type MemoryGraphEdgeKind = "SUBJECT" | "PREDICATE" | "OBJECT";

export interface MemoryGraphViewNode {
  id: string;
  kind: MemoryGraphNodeKind;
  /** The text drawn on the node. */
  label: string;
  /** The hover card's body. The fact's whole sentence, or a satellite's name. */
  detail: string;
  createdAt: string | null;
  /**
   * Incident edges *as drawn*. Not the node's degree in Neo4j: an edge whose
   * other endpoint fell past the node ceiling is not drawn, and counting it
   * would size a node by connections the reader cannot see.
   */
  degree: number;
}

export interface MemoryGraphViewEdge {
  id: string;
  source: string;
  target: string;
  kind: MemoryGraphEdgeKind;
}

export interface MemoryGraphView {
  nodes: MemoryGraphViewNode[];
  edges: MemoryGraphViewEdge[];
  /** Current facts the store holds, before the read ceiling. */
  totalFacts: number;
  /** True when the read ceiling dropped facts, so the UI can say so rather than lie. */
  truncated: boolean;
}

/**
 * What each node kind is called, and which design token colours it.
 *
 * Exported because the legend, the detail card and the keyboard announcement all
 * name the same kinds, and a second copy of these strings in a component would
 * let the legend disagree with what the canvas drew.
 *
 * The tokens are the chart palette rather than the semantic `--red`/`--green`:
 * those carry error and success meaning everywhere else in the app, and a node
 * kind spending them would read as a state.
 */
export const MEMORY_GRAPH_NODE_LABELS: Record<MemoryGraphNodeKind, string> = {
  fact: "Memory",
  entity: "Entity",
  predicate: "Predicate",
  value: "Value",
};
export const MEMORY_GRAPH_NODE_TOKEN: Record<MemoryGraphNodeKind, string> = {
  fact: "--chart-1",
  entity: "--chart-2",
  predicate: "--chart-3",
  value: "--chart-4",
};

/**
 * What each edge kind is called, in one place, for the same reason.
 *
 * The style carries the token, the stroke width and a dash pattern. The dash is
 * an array rather than the SVG string the canvas would have to parse, because
 * `setLineDash` takes numbers and a string would push the parsing to the call
 * site where it could differ between the legend and the drawing.
 */
export const MEMORY_GRAPH_EDGE_LABELS: Record<MemoryGraphEdgeKind, string> = {
  SUBJECT: "subject",
  PREDICATE: "predicate",
  OBJECT: "object",
};
export const MEMORY_GRAPH_EDGE_STYLE: Record<
  MemoryGraphEdgeKind,
  { token: string; width: number; dash: number[] | null }
> = {
  SUBJECT: { token: "--text-soft", width: 1.5, dash: null },
  PREDICATE: { token: "--text-muted", width: 1.5, dash: [6, 3] },
  OBJECT: { token: "--border-strong", width: 1.5, dash: [2, 3] },
};

/**
 * The drawn radius, growing with degree up to the ceiling.
 *
 * The square root is what keeps a hub of fifty links from dwarfing the rest:
 * area, not radius, is what the eye reads as size, so radius tracks the square
 * root of degree.
 */
export function nodeRadius(kind: MemoryGraphNodeKind, degree: number): number {
  const base = MEMORY_GRAPH_NODE_BASE_RADIUS[kind];
  const grown = base + MEMORY_GRAPH_DEGREE_RADIUS_SCALE * Math.sqrt(Math.max(degree, 0));
  return Math.min(grown, MEMORY_GRAPH_MAX_NODE_RADIUS);
}

/** The Neo4j label → drawn kind map. A subject or object of any other label is not drawn. */
const SATELLITE_KINDS: Record<string, MemoryGraphNodeKind | undefined> = {
  Entity: "entity",
  Value: "value",
};

function satelliteKindFor(label: string | null): MemoryGraphNodeKind | null {
  if (!label) return null;
  return SATELLITE_KINDS[label] ?? null;
}

/** Ranks a satellite: most connected first, ties broken by name then id so the cut is stable. */
function compareSatellites(
  a: MemoryGraphViewNode,
  b: MemoryGraphViewNode,
  degree: Map<string, number>,
): number {
  const byDegree = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
  if (byDegree !== 0) return byDegree;
  const byLabel = a.label.localeCompare(b.label);
  if (byLabel !== 0) return byLabel;
  return a.id.localeCompare(b.id);
}

/**
 * Builds the drawn graph. Deterministic: the same rows always produce the same
 * node order, which is what lets the layout be reproducible.
 *
 * The ceiling is applied to satellites only. A fact is what the reader came for;
 * the satellites are the connective tissue between facts, so a cap drops the
 * mentioned-once concepts rather than the things they connect.
 */
export function buildMemoryGraphView(
  rows: MemoryGraphFactRow[],
  totalFacts: number,
  nodeLimit: number = MEMORY_GRAPH_NODE_LIMIT,
): MemoryGraphView {
  const factNodes: MemoryGraphViewNode[] = rows.map((row) => ({
    id: `fact:${row.factId}`,
    kind: "fact",
    label: row.text,
    detail: row.text,
    createdAt: row.createdAt,
    degree: 0,
  }));

  const satellites = new Map<string, MemoryGraphViewNode>();
  const edges: MemoryGraphViewEdge[] = [];

  const addSatellite = (
    kind: MemoryGraphNodeKind,
    id: string,
    name: string | null,
  ): MemoryGraphViewNode => {
    const key = `${kind}:${id}`;
    const existing = satellites.get(key);
    if (existing) return existing;
    const node: MemoryGraphViewNode = {
      id: key,
      kind,
      label: name ?? "",
      detail: name ?? "",
      createdAt: null,
      degree: 0,
    };
    satellites.set(key, node);
    return node;
  };

  for (const row of rows) {
    const source = `fact:${row.factId}`;

    // The `:User` anchor is the subject of nearly every fact, so it is not
    // drawn: a star of degree n says nothing and collapses the layout. Its edge
    // goes with it, and the fact keeps its predicate and object edges.
    if (row.subjectId && row.subjectKind !== "User") {
      const kind = satelliteKindFor(row.subjectKind);
      if (kind) {
        const node = addSatellite(kind, row.subjectId, row.subjectName);
        edges.push({
          id: `subject:${row.factId}:${row.subjectId}`,
          source,
          target: node.id,
          kind: "SUBJECT",
        });
      }
    }

    if (row.predicateId) {
      const node = addSatellite("predicate", row.predicateId, row.predicateName);
      edges.push({
        id: `predicate:${row.factId}:${row.predicateId}`,
        source,
        target: node.id,
        kind: "PREDICATE",
      });
    }

    if (row.objectId) {
      const kind = satelliteKindFor(row.objectKind);
      if (kind) {
        const node = addSatellite(kind, row.objectId, row.objectName);
        edges.push({
          id: `object:${row.factId}:${row.objectId}`,
          source,
          target: node.id,
          kind: "OBJECT",
        });
      }
    }
  }

  // Degree *as drawn*, counted before the ceiling so the ranking sorts by real
  // connectivity rather than by whatever survived.
  const fullDegree = new Map<string, number>();
  for (const edge of edges) {
    fullDegree.set(edge.source, (fullDegree.get(edge.source) ?? 0) + 1);
    fullDegree.set(edge.target, (fullDegree.get(edge.target) ?? 0) + 1);
  }

  const allSatellites = [...satellites.values()];
  let kept = new Set<string>([
    ...factNodes.map((node) => node.id),
    ...allSatellites.map((node) => node.id),
  ]);

  if (kept.size > nodeLimit) {
    const budget = Math.max(nodeLimit - factNodes.length, 0);
    const ranked = [...allSatellites].sort((a, b) =>
      compareSatellites(a, b, fullDegree),
    );
    kept = new Set<string>([
      ...factNodes.map((node) => node.id),
      ...ranked.slice(0, budget).map((node) => node.id),
    ]);
  }

  // Edges are rebuilt from the survivors, so a dropped satellite takes its
  // edges with it rather than leaving a line to a node that is not there.
  const keptEdges = edges.filter(
    (edge) => kept.has(edge.source) && kept.has(edge.target),
  );

  const degree = new Map<string, number>();
  for (const edge of keptEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  // Facts first, in the order the query returned them (newest first), then
  // satellites by degree — a stable drawing order.
  const nodes: MemoryGraphViewNode[] = [
    ...factNodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
    ...allSatellites
      .filter((node) => kept.has(node.id))
      .sort((a, b) => compareSatellites(a, b, degree))
      .map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
  ];

  return {
    nodes,
    edges: keptEdges,
    totalFacts,
    // Truncation is a fact about the *read*, so only the read ceiling sets it.
    // A node-ceiling drop is the drawing's own bound and does not claim the
    // store holds more than was fetched.
    truncated: totalFacts > rows.length,
  };
}

/**
 * The node ids the search box lights up, or `null` when there is no search.
 *
 * Highlighting rather than filtering: a canvas cannot cheaply re-run the layout
 * per keystroke, and dimming the rest is both cheaper and how this kind of view
 * behaves. `null` rather than an empty set for a blank query, because an empty
 * set would dim every node.
 *
 * A matching fact lights its own satellites too — a lit hub joined only to dim
 * satellites reads as a broken star. The reverse does not hold: a matching
 * satellite lights itself, because the reader searching a predicate's name is
 * looking for the predicate, not for every fact that uses it.
 */
export function matchMemoryGraphNodes(
  view: MemoryGraphView,
  query: string,
): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const matched = new Set(
    view.nodes
      .filter((node) => node.label.toLowerCase().includes(needle))
      .map((node) => node.id),
  );

  for (const edge of view.edges) {
    if (matched.has(edge.source) && edge.source.startsWith("fact:")) {
      matched.add(edge.target);
    }
  }

  return matched;
}

/**
 * The order the keyboard walks the picture in: most connected first.
 *
 * A keyboard reader cannot step through every node and would not want to; the
 * hubs are what the picture is *about*. A specific low-degree node is found
 * through the search box, which lights it instead.
 */
export function keyboardTraversalOrder(view: MemoryGraphView): string[] {
  return view.nodes
    .slice()
    .sort((a, b) => compareSatellites(a, b, new Map(view.nodes.map((n) => [n.id, n.degree]))))
    .map((node) => node.id);
}
