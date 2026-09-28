import { describe, expect, it } from "vitest";
import {
  buildMemoryGraphView,
  filterMemoryGraphView,
  type MemoryGraphAboutRow,
  type MemoryGraphMemoryEdgeRow,
  type MemoryGraphMemoryRow,
  type MemoryGraphRelationRow,
  type MemoryGraphRows,
} from "@/lib/memory/graph-view";

// Fixed fixtures rather than generated ones: the assertions below compare node
// order and truncation, and both must be independent of wall-clock time.

const memoryRow = (
  over: Partial<MemoryGraphMemoryRow> = {},
): MemoryGraphMemoryRow => ({
  id: "m1",
  content: "I deploy on Fridays",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const aboutRow = (over: Partial<MemoryGraphAboutRow> = {}): MemoryGraphAboutRow => ({
  memoryId: "m1",
  entityId: "e1",
  entityName: "acme",
  normalizedName: "acme",
  ...over,
});

const memoryEdge = (
  over: Partial<MemoryGraphMemoryEdgeRow> = {},
): MemoryGraphMemoryEdgeRow => ({
  source: "m1",
  target: "m2",
  type: "RELATES_TO",
  weight: 0.5,
  reason: null,
  ...over,
});

const relationRow = (
  over: Partial<MemoryGraphRelationRow> = {},
): MemoryGraphRelationRow => ({
  source: "e1",
  target: "e2",
  relationType: "employs",
  ...over,
});

const rows = (over: Partial<MemoryGraphRows> = {}): MemoryGraphRows => ({
  memories: [],
  about: [],
  memoryEdges: [],
  entityRelations: [],
  ...over,
});

describe("buildMemoryGraphView", () => {
  it("returns nothing for an empty graph", () => {
    const view = buildMemoryGraphView(rows(), 0);
    expect(view.nodes).toEqual([]);
    expect(view.edges).toEqual([]);
    expect(view.truncated).toBe(false);
  });

  it("keeps the order the query returned, which is newest first", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [
          memoryRow({ id: "new", createdAt: "2026-03-01T00:00:00.000Z" }),
          memoryRow({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
        ],
      }),
      2,
    );
    expect(view.nodes.map((node) => node.id)).toEqual(["new", "old"]);
  });

  it("draws an entity for each ABOUT row and labels it by its normalized name", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" })],
        about: [aboutRow({ memoryId: "m1", entityId: "e1", entityName: "Acme Inc", normalizedName: "acme" })],
      }),
      10,
    );
    const entity = view.nodes.find((node) => node.id === "e1");
    expect(entity?.kind).toBe("entity");
    expect(entity?.label).toBe("acme");
    expect(entity?.detail).toBe("Acme Inc");
  });

  it("drops an ABOUT row whose memory fell outside the read window", () => {
    // The window is what the user can see; an entity hanging off a memory that
    // is not drawn would be an unreadable orphan.
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" })],
        about: [
          aboutRow({ memoryId: "m1", entityId: "e1" }),
          aboutRow({ memoryId: "m_absent", entityId: "e_orphan" }),
        ],
      }),
      10,
    );
    expect(view.nodes.map((node) => node.id).sort()).toEqual(["e1", "m1"]);
  });

  it("counts each kept memory's mention of a shared entity", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        about: [
          aboutRow({ memoryId: "m1", entityId: "shared" }),
          aboutRow({ memoryId: "m2", entityId: "shared" }),
        ],
      }),
      10,
    );
    const shared = view.nodes.find((node) => node.id === "shared");
    expect(shared?.degree).toBe(2);
    // One entity, not two: the map is keyed by id.
    expect(view.nodes.filter((node) => node.kind === "entity")).toHaveLength(1);
  });

  it("caps entities by how many memories mention them, keeping the busiest", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        about: [
          aboutRow({ memoryId: "m1", entityId: "popular" }),
          aboutRow({ memoryId: "m2", entityId: "popular" }),
          aboutRow({ memoryId: "m1", entityId: "rare" }),
        ],
      }),
      3, // two memories leave a budget of one entity
      3,
    );
    expect(view.nodes.map((node) => node.id).sort()).toEqual(["m1", "m2", "popular"]);
    expect(view.truncated).toBe(true);
  });

  it("breaks an entity tie by name, so the cut is stable", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" })],
        about: [
          aboutRow({ memoryId: "m1", entityId: "z", normalizedName: "zeta" }),
          aboutRow({ memoryId: "m1", entityId: "a", normalizedName: "alpha" }),
        ],
      }),
      2, // one memory leaves a budget of one entity, and both are linked once
      2,
    );
    expect(view.nodes.map((node) => node.id)).toEqual(["m1", "a"]);
  });

  it("reports truncation when the store holds more memories than were read", () => {
    const view = buildMemoryGraphView(
      rows({ memories: [memoryRow({ id: "m1" })] }),
      1284,
    );
    expect(view.truncated).toBe(true);
    expect(view.totalMemories).toBe(1284);
  });

  it("keeps a memory edge only when both endpoints are drawn", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        memoryEdges: [
          memoryEdge({ source: "m1", target: "m2" }),
          memoryEdge({ source: "m1", target: "m_absent" }),
        ],
      }),
      10,
    );
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0].kind).toBe("RELATES_TO");
  });

  it("ignores a relationship type this build does not know", () => {
    // A future type must not render with an undefined style; the set is closed
    // for the same reason MEMORY_LLM_EDGE_TYPES is.
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        memoryEdges: [memoryEdge({ type: "INVENTED_BY_A_MODEL" })],
      }),
      10,
    );
    expect(view.edges).toEqual([]);
  });

  it("carries the model's edge weight and reason through", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        memoryEdges: [
          memoryEdge({ type: "SUPERSEDES", weight: 0.8, reason: "newer vendor" }),
        ],
      }),
      10,
    );
    expect(view.edges[0]).toMatchObject({
      kind: "SUPERSEDES",
      label: "supersedes",
      weight: 0.8,
      reason: "newer vendor",
    });
  });

  it("names an entity relation by the relation's own type", () => {
    // Replacing "employs" with the generic "related" would discard the only
    // information that edge carries.
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" })],
        about: [
          aboutRow({ memoryId: "m1", entityId: "e1" }),
          aboutRow({ memoryId: "m1", entityId: "e2" }),
        ],
        entityRelations: [relationRow({ source: "e1", target: "e2", relationType: "employs" })],
      }),
      10,
    );
    expect(view.edges.find((edge) => edge.kind === "RELATION")?.label).toBe("employs");
  });

  it("falls back to a generic label when the relation carries no type", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" })],
        about: [
          aboutRow({ memoryId: "m1", entityId: "e1" }),
          aboutRow({ memoryId: "m1", entityId: "e2" }),
        ],
        entityRelations: [relationRow({ source: "e1", target: "e2", relationType: null })],
      }),
      10,
    );
    expect(view.edges.find((edge) => edge.kind === "RELATION")?.label).toBe("related");
  });

  it("gives every edge a unique id", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        about: [aboutRow({ memoryId: "m1", entityId: "e1" })],
        memoryEdges: [
          memoryEdge({ source: "m1", target: "m2", type: "RELATES_TO" }),
          memoryEdge({ source: "m1", target: "m2", type: "CONTRADICTS" }),
          memoryEdge({ source: "m2", target: "m1", type: "RELATES_TO" }),
        ],
      }),
      10,
    );
    const ids = view.edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Direction is part of identity: A→B and B→A are two different claims.
    expect(ids).toHaveLength(4);
  });

  it("degrees a node only by the edges that are actually drawn", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" }), memoryRow({ id: "m2" })],
        about: [aboutRow({ memoryId: "m1", entityId: "e1" })],
        memoryEdges: [memoryEdge({ source: "m1", target: "m_absent" })],
      }),
      10,
    );
    // One drawn ABOUT edge, and the dangling memory edge contributes nothing.
    expect(view.nodes.find((node) => node.id === "m1")?.degree).toBe(1);
    expect(view.nodes.find((node) => node.id === "m2")?.degree).toBe(0);
  });

  it("returns memory nodes before entity nodes, so the order is stable", () => {
    const view = buildMemoryGraphView(
      rows({
        memories: [memoryRow({ id: "m1" })],
        about: [aboutRow({ memoryId: "m1", entityId: "e1" })],
      }),
      10,
    );
    expect(view.nodes.map((node) => node.kind)).toEqual(["memory", "entity"]);
  });
});

describe("filterMemoryGraphView", () => {
  const built = () =>
    buildMemoryGraphView(
      rows({
        memories: [
          memoryRow({ id: "m1", content: "I deploy on Fridays" }),
          memoryRow({ id: "m2", content: "The cat is asleep" }),
        ],
        about: [
          aboutRow({ memoryId: "m1", entityId: "e1", entityName: "Acme Inc", normalizedName: "acme" }),
          aboutRow({ memoryId: "m2", entityId: "e2", entityName: "Globex", normalizedName: "globex" }),
        ],
      }),
      2,
    );

  it("returns the view untouched for an empty query", () => {
    const view = built();
    expect(filterMemoryGraphView(view, "")).toBe(view);
    expect(filterMemoryGraphView(view, "   ")).toBe(view);
  });

  it("keeps only the node that matched, not its neighbours", () => {
    // Consistent with the list view, which shows matching memories and nothing
    // else. Pulling in a matched memory's entities would mean a search result
    // contains rows the query did not match, and for a dense graph the first
    // match would drag in most of the corpus.
    const filtered = filterMemoryGraphView(built(), "deploy");
    expect(filtered.nodes.map((node) => node.id)).toEqual(["m1"]);
    // The ABOUT edge now has one endpoint, so it goes too.
    expect(filtered.edges).toEqual([]);
  });

  it("matches an entity on its display name as well as its normalized key", () => {
    // "Acme Inc" normalizes to "acme", so a search for the punctuation-bearing
    // form must still find it.
    const filtered = filterMemoryGraphView(built(), "inc");
    expect(filtered.nodes.map((node) => node.id)).toEqual(["e1"]);
  });

  it("is case-insensitive", () => {
    expect(filterMemoryGraphView(built(), "DEPLOY").nodes.map((n) => n.id)).toEqual(["m1"]);
  });

  it("drops an edge whose other endpoint was filtered out", () => {
    // Matching only the entity leaves the memory out, so the ABOUT edge has one
    // endpoint and must go with it.
    const filtered = filterMemoryGraphView(built(), "globex");
    expect(filtered.nodes.map((node) => node.id)).toEqual(["e2"]);
    expect(filtered.edges).toEqual([]);
  });

  it("recomputes degree against the filtered edge set", () => {
    // Both memories match "deploy" and are linked, so the surviving edge is
    // drawn and both endpoints degree 1 — the ABOUT edge to e1 is gone.
    const view = buildMemoryGraphView(
      rows({
        memories: [
          memoryRow({ id: "m1", content: "I deploy on Fridays" }),
          memoryRow({ id: "m2", content: "The deploy window is Friday" }),
        ],
        about: [aboutRow({ memoryId: "m1", entityId: "e1" })],
        memoryEdges: [memoryEdge({ source: "m1", target: "m2" })],
      }),
      2,
    );

    const filtered = filterMemoryGraphView(view, "deploy");

    expect(filtered.nodes.map((node) => node.id)).toEqual(["m1", "m2"]);
    expect(filtered.edges.map((edge) => edge.id)).toEqual(["memory:m1:m2:RELATES_TO"]);
    expect(filtered.nodes.find((node) => node.id === "m1")?.degree).toBe(1);
    expect(filtered.nodes.find((node) => node.id === "m2")?.degree).toBe(1);
  });

  it("returns nothing when the query matches nothing", () => {
    const filtered = filterMemoryGraphView(built(), "nothing matches this");
    expect(filtered.nodes).toEqual([]);
    expect(filtered.edges).toEqual([]);
  });

  it("inherits truncation, which filtering cannot undo", () => {
    const view = buildMemoryGraphView(rows({ memories: [memoryRow({ id: "m1" })] }), 500);
    expect(filterMemoryGraphView(view, "deploy").truncated).toBe(true);
    expect(filterMemoryGraphView(view, "deploy").totalMemories).toBe(500);
  });
});
