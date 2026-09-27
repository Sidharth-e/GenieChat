import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "@/lib/workflow/cycle-detection";
import type { Connection } from "@xyflow/react";

function edge(source: string, target: string): Connection {
  return { source, target } as Connection;
}

describe("wouldCreateCycle", () => {
  it("returns false for a linear chain A→B→C with a new edge C→D", () => {
    const existing: Connection[] = [edge("A", "B"), edge("B", "C")];
    expect(wouldCreateCycle(edge("C", "D"), existing)).toBe(false);
  });

  it("returns false for a DAG with a merge node (no cycle)", () => {
    const existing: Connection[] = [edge("A", "C"), edge("B", "C")];
    expect(wouldCreateCycle(edge("D", "A"), existing)).toBe(false);
  });

  it("returns false for an empty existing edges list", () => {
    expect(wouldCreateCycle(edge("A", "B"), [])).toBe(false);
  });

  it("returns true for a direct two-node cycle A→B, new edge B→A", () => {
    const existing: Connection[] = [edge("A", "B")];
    expect(wouldCreateCycle(edge("B", "A"), existing)).toBe(true);
  });

  it("returns true for a three-node cycle A→B→C, new edge C→A", () => {
    const existing: Connection[] = [edge("A", "B"), edge("B", "C")];
    expect(wouldCreateCycle(edge("C", "A"), existing)).toBe(true);
  });

  it("returns true for a self-loop A→A", () => {
    expect(wouldCreateCycle(edge("A", "A"), [])).toBe(true);
  });

  it("returns false when new connection has null source", () => {
    const conn = { source: null, target: "B" } as unknown as Connection;
    expect(wouldCreateCycle(conn, [])).toBe(false);
  });

  it("returns false when new connection has null target", () => {
    const conn = { source: "A", target: null } as unknown as Connection;
    expect(wouldCreateCycle(conn, [])).toBe(false);
  });

  it("skips existing edges with null source or target", () => {
    const existing = [{ source: null, target: "B" } as unknown as Connection];
    expect(wouldCreateCycle(edge("B", "A"), existing)).toBe(false);
  });
});
