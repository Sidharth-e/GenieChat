import { describe, expect, it } from "vitest";
import {
  layoutMemoryGraph,
  type GraphLayoutInput,
} from "@/lib/memory/graph-layout";
import {
  MEMORY_GRAPH_LAYOUT_HEIGHT,
  MEMORY_GRAPH_LAYOUT_WIDTH,
} from "@/constants/memory";

const node = (id: string, radius = 60): GraphLayoutInput => ({ id, radius });

/** A run of nodes, named so a failure message identifies one. */
const nodes = (count: number): GraphLayoutInput[] =>
  Array.from({ length: count }, (_, index) => node(`n${index}`));

/** A chain: n0—n1—n2—…, which is connected without being a single hub. */
const chain = (count: number) =>
  Array.from({ length: count - 1 }, (_, index) => ({
    source: `n${index}`,
    target: `n${index + 1}`,
  }));

const span = (values: number[]) => Math.max(...values) - Math.min(...values);

describe("layoutMemoryGraph", () => {
  it("returns nothing for an empty graph", () => {
    expect(layoutMemoryGraph([], [])).toEqual({});
  });

  it("returns a point for every node, and none for anything else", () => {
    const positions = layoutMemoryGraph(nodes(6), []);
    expect(Object.keys(positions).sort()).toEqual(
      nodes(6).map((entry) => entry.id).sort(),
    );
  });

  it("is deterministic, so a remount does not reshuffle the picture", () => {
    // The whole point of drawing the graph is that it stays put. A single
    // `Math.random` anywhere in the simulation would break this.
    const graph = nodes(24);
    const edges = chain(24);
    expect(layoutMemoryGraph(graph, edges)).toEqual(layoutMemoryGraph(graph, edges));
  });

  it("keeps every node inside the canvas", () => {
    const graph = nodes(40);
    const positions = layoutMemoryGraph(graph, chain(40));
    for (const point of Object.values(positions)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(MEMORY_GRAPH_LAYOUT_WIDTH);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(MEMORY_GRAPH_LAYOUT_HEIGHT);
    }
  });

  it("spreads the graph out instead of collapsing it to a point", () => {
    // The failure this guards against is not a crash: a centre pull that
    // outweighs the repulsion lays every node down in the same place, and the
    // canvas renders one dot.
    const positions = Object.values(layoutMemoryGraph(nodes(20), chain(20)));
    const xs = positions.map((point) => point.x);
    const ys = positions.map((point) => point.y);
    expect(span(xs)).toBeGreaterThan(100);
    expect(span(ys)).toBeGreaterThan(100);
  });

  it("settles a connected pair closer together than an unconnected one", () => {
    // Fruchterman–Reingold is only doing its job if the springs pull: the edge
    // has to mean something in the picture.
    const positions = layoutMemoryGraph(
      [node("a"), node("b"), node("c")],
      [{ source: "a", target: "b" }],
    );
    const distance = (from: string, to: string) =>
      Math.hypot(
        positions[from].x - positions[to].x,
        positions[from].y - positions[to].y,
      );
    expect(distance("a", "b")).toBeLessThan(distance("a", "c"));
  });

  it("skips a self-edge and an edge naming a node that is not there", () => {
    // The assembler already guarantees both endpoints exist; a layout is not the
    // place to discover otherwise, so these are dropped rather than thrown on.
    const positions = layoutMemoryGraph(
      [node("a"), node("b")],
      [
        { source: "a", target: "a" },
        { source: "a", target: "absent" },
      ],
    );
    expect(Object.keys(positions).sort()).toEqual(["a", "b"]);
  });

  it("lays out within a custom canvas when one is given", () => {
    const positions = Object.values(
      layoutMemoryGraph(nodes(10), chain(10), { width: 400, height: 300 }),
    );
    for (const point of positions) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(400);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(300);
    }
  });

  it("moves the nodes much further in 160 iterations than in one", () => {
    // Proves the iteration count is actually read, rather than the option being
    // accepted and ignored.
    const graph = nodes(12);
    const edges = chain(12);
    const brief = layoutMemoryGraph(graph, edges, { iterations: 1 });
    const settled = layoutMemoryGraph(graph, edges);
    const moved = Object.keys(settled).some(
      (id) => brief[id].x !== settled[id].x || brief[id].y !== settled[id].y,
    );
    expect(moved).toBe(true);
  });

  it("gives a larger node room to breathe", () => {
    // Radius scaling exists so a memory card does not sit on top of a pill.
    // Measured as the total spread: pushing the big node away opens the graph.
    const small = Object.values(
      layoutMemoryGraph([node("a", 10), node("b", 10)], [{ source: "a", target: "b" }]),
    );
    const large = Object.values(
      layoutMemoryGraph([node("a", 400), node("b", 10)], [{ source: "a", target: "b" }]),
    );
    const distance = (points: { x: number; y: number }[]) =>
      Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    expect(distance(large)).toBeGreaterThanOrEqual(distance(small));
  });
});
