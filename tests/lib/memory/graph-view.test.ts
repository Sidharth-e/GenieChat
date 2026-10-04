import { describe, expect, it } from "vitest";
import {
  buildMemoryGraphView,
  keyboardTraversalOrder,
  matchMemoryGraphNodes,
  nodeRadius,
  type MemoryGraphFactRow,
} from "@/lib/memory/graph-view";

function factRow(over: Partial<MemoryGraphFactRow> = {}): MemoryGraphFactRow {
  return {
    factId: "f1",
    text: "works as a Rust developer",
    createdAt: "2026-01-01T00:00:00.000Z",
    subjectId: "u1",
    subjectKind: "User",
    subjectName: null,
    predicateId: "p1",
    predicateName: "WORKS_AS",
    objectId: "v1",
    objectKind: "Value",
    objectName: "Rust developer",
    ...over,
  };
}

describe("buildMemoryGraphView", () => {
  it("draws the user anchor once, with a subject edge from every fact that hangs off it", () => {
    const view = buildMemoryGraphView(
      [factRow({ factId: "f1" }), factRow({ factId: "f2" })],
      2,
    );
    const anchors = view.nodes.filter((n) => n.kind === "user");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].id).toBe("user:u1");
    expect(anchors[0].degree).toBe(2);
    expect(view.edges.map((e) => e.kind).sort()).toEqual([
      "OBJECT",
      "OBJECT",
      "PREDICATE",
      "PREDICATE",
      "SUBJECT",
      "SUBJECT",
    ]);
  });

  it("labels the anchor with the user's name, falling back to the pronoun", () => {
    const label = (subjectName: string | null) =>
      buildMemoryGraphView([factRow({ subjectName })], 1).nodes.find(
        (n) => n.kind === "user",
      )?.label;
    expect(label(null)).toBe("You");
    expect(label("Ada")).toBe("Ada");
  });

  it("draws an entity subject as an edge when the subject is not the anchor", () => {
    const row = factRow({
      subjectId: "e1",
      subjectKind: "Entity",
      subjectName: "Rust",
      objectId: "e2",
      objectKind: "Entity",
      objectName: "Tokio",
    });
    const view = buildMemoryGraphView([row], 1);
    expect(
      view.nodes
        .filter((n) => n.kind === "entity")
        .map((n) => n.label)
        .sort(),
    ).toEqual(["Rust", "Tokio"]);
    expect(view.edges.map((e) => e.kind).sort()).toEqual([
      "OBJECT",
      "PREDICATE",
      "SUBJECT",
    ]);
  });

  it("shares one satellite node across facts and counts every link as degree", () => {
    const rows = [factRow({ factId: "f1" }), factRow({ factId: "f2" })];
    const view = buildMemoryGraphView(rows, 2);
    expect(view.nodes.filter((n) => n.id === "value:v1")).toHaveLength(1);
    expect(view.nodes.find((n) => n.id === "value:v1")?.degree).toBe(2);
    expect(view.nodes.find((n) => n.id === "fact:f1")?.degree).toBe(3); // subject + predicate + object
  });

  it("carries the fact sentence as the fact's detail and the count as truncation", () => {
    const view = buildMemoryGraphView([factRow()], 40);
    expect(view.nodes.find((n) => n.id === "fact:f1")?.detail).toBe(
      "works as a Rust developer",
    );
    expect(view.truncated).toBe(true);
    expect(view.totalFacts).toBe(40);
  });

  it("is not truncated when the read returned everything", () => {
    expect(buildMemoryGraphView([factRow()], 1).truncated).toBe(false);
  });

  it("drops the lowest-degree satellites past the node limit, keeping facts and the anchor", () => {
    const rows = [
      factRow({ factId: "f1", objectId: "v1" }),
      factRow({ factId: "f2", objectId: "v2" }),
      factRow({ factId: "f3", objectId: "v3" }),
    ];
    const view = buildMemoryGraphView(rows, 3, 4); // 3 facts + the anchor fill the budget
    expect(view.nodes.filter((n) => n.kind === "fact")).toHaveLength(3);
    expect(view.nodes.filter((n) => n.kind === "user")).toHaveLength(1);
    expect(view.nodes).toHaveLength(4);
    expect(view.nodes.some((n) => n.kind === "predicate")).toBe(false);
    expect(view.nodes.some((n) => n.kind === "value")).toBe(false);
  });

  it("tolerates a fact whose satellites are missing rather than dropping the fact", () => {
    const row = factRow({
      subjectId: null,
      subjectKind: null,
      subjectName: null,
      predicateId: null,
      predicateName: null,
      objectId: null,
      objectKind: null,
      objectName: null,
    });
    const view = buildMemoryGraphView([row], 1);
    expect(view.nodes.map((n) => n.id)).toEqual(["fact:f1"]);
    expect(view.edges).toEqual([]);
  });
});

describe("nodeRadius", () => {
  it("grows with degree and stops at the ceiling", () => {
    expect(nodeRadius("predicate", 0)).toBeLessThan(nodeRadius("predicate", 9));
    expect(nodeRadius("predicate", 100000)).toBe(20);
  });

  it("gives each kind its own base, so kind is size as well as colour", () => {
    expect(nodeRadius("entity", 0)).toBeGreaterThan(nodeRadius("value", 0));
    expect(nodeRadius("user", 0)).toBeGreaterThan(nodeRadius("entity", 0));
  });
});

describe("matchMemoryGraphNodes", () => {
  it("returns null for a blank query, so nothing is dimmed", () => {
    const view = buildMemoryGraphView([factRow()], 1);
    expect(matchMemoryGraphNodes(view, "   ")).toBeNull();
  });

  it("matches a fact by its sentence and a satellite by its label", () => {
    const view = buildMemoryGraphView([factRow()], 1);
    // A matching fact lights its satellites — including the anchor it hangs off.
    expect(matchMemoryGraphNodes(view, "rust")).toEqual(
      new Set(["fact:f1", "value:v1", "predicate:p1", "user:u1"]),
    );
    expect(matchMemoryGraphNodes(view, "WORKS_AS")).toEqual(
      new Set(["predicate:p1"]),
    );
  });

  it("returns an empty set, not null, when an active search matches nothing", () => {
    const view = buildMemoryGraphView([factRow()], 1);
    expect(matchMemoryGraphNodes(view, "zzz")).toEqual(new Set());
  });
});

describe("keyboardTraversalOrder", () => {
  it("visits the most connected nodes first, deterministically", () => {
    const rows = [
      factRow({ factId: "f1", objectId: "v1", predicateId: "p1" }),
      factRow({ factId: "f2", objectId: "v1", predicateId: "p2" }),
    ];
    // `v1` is shared by both facts, `p2` by one, so degree puts `v1` first
    // whichever way the ties between same-degree nodes are collated.
    const order = keyboardTraversalOrder(buildMemoryGraphView(rows, 2));
    expect(order.indexOf("value:v1")).toBeLessThan(
      order.indexOf("predicate:p2"),
    );
    expect(order).toEqual(
      keyboardTraversalOrder(buildMemoryGraphView(rows, 2)),
    );
  });
});
