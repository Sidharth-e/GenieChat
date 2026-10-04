import { describe, expect, it } from "vitest";
import { createMemoryLayout, seedMemoryLayout } from "@/lib/memory/graph-layout";

const inputs = [
  { id: "a", radius: 4 },
  { id: "b", radius: 4 },
  { id: "c", radius: 4 },
];
const edges = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
];
const options = { width: 800, height: 600 };

const finite = (nodes: { x: number; y: number }[]) =>
  nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));

describe("seedMemoryLayout", () => {
  it("gives every node a finite position, all distinct", () => {
    const nodes = seedMemoryLayout(inputs, 800, 600);
    expect(nodes).toHaveLength(3);
    expect(finite(nodes)).toBe(true);
    expect(new Set(nodes.map((n) => `${n.x},${n.y}`)).size).toBe(3);
  });

  it("is deterministic, so a remount does not reshuffle the picture", () => {
    expect(seedMemoryLayout(inputs, 800, 600)).toEqual(
      seedMemoryLayout(inputs, 800, 600),
    );
  });

  it("handles an empty graph", () => {
    expect(seedMemoryLayout([], 800, 600)).toEqual([]);
  });
});

describe("createMemoryLayout", () => {
  it("does not advance on its own — d3 starts a timer and it must be stopped", async () => {
    const sim = createMemoryLayout(seedMemoryLayout(inputs, 800, 600), edges, options);
    const before = sim.alpha();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sim.alpha()).toBe(before);
  });

  it("settles to finite positions", () => {
    const sim = createMemoryLayout(seedMemoryLayout(inputs, 800, 600), edges, options);
    sim.tick(300);
    expect(finite(sim.nodes)).toBe(true);
    expect(sim.alpha()).toBeLessThan(0.05);
  });

  it("is deterministic across two independent runs", () => {
    const run = () => {
      const sim = createMemoryLayout(seedMemoryLayout(inputs, 800, 600), edges, options);
      sim.tick(300);
      return sim.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
    };
    expect(run()).toEqual(run());
  });

  it("pulls linked nodes together", () => {
    const mean = (nodes: { id: string; x: number; y: number }[]) =>
      (Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y) +
        Math.hypot(nodes[1].x - nodes[2].x, nodes[1].y - nodes[2].y)) /
      2;
    const seeded = seedMemoryLayout(inputs, 800, 600);
    const before = mean(seeded);
    const sim = createMemoryLayout(seeded, edges, options);
    sim.tick(300);
    expect(mean(sim.nodes)).toBeLessThan(before);
  });

  it("reheat raises alpha, so a drag can wake a settled graph", () => {
    const sim = createMemoryLayout(seedMemoryLayout(inputs, 800, 600), edges, options);
    sim.tick(300);
    sim.reheat();
    expect(sim.alpha()).toBeGreaterThan(0.5);
  });

  it("holds a pinned node where it was put", () => {
    const sim = createMemoryLayout(seedMemoryLayout(inputs, 800, 600), edges, options);
    sim.pin("a", 111, 222);
    sim.tick(100);
    const a = sim.nodes.find((n) => n.id === "a");
    expect(a?.x).toBeCloseTo(111, 5);
    expect(a?.y).toBeCloseTo(222, 5);
    sim.pin("a", 111, null); // release back to the simulation
    expect(finite(sim.nodes)).toBe(true);
  });

  it("ignores an edge naming a node that is not drawn", () => {
    const sim = createMemoryLayout(
      seedMemoryLayout(inputs, 800, 600),
      [...edges, { source: "a", target: "gone" }],
      options,
    );
    expect(() => sim.tick(50)).not.toThrow();
    expect(finite(sim.nodes)).toBe(true);
  });
});
