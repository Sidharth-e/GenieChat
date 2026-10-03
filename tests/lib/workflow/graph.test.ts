import { describe, expect, it } from "vitest";
import {
  buildAdjacency,
  conditionEdgeTargets,
  executableNodes,
  findEntryNodes,
  findTerminalNodes,
} from "@/lib/workflow/graph";
import { NodeKind } from "@/lib/workflow/types";
import type { ConditionBranches } from "@/lib/workflow/condition";
import type { RichWorkflowEdge, RichWorkflowNode } from "@/lib/types";

const node = (id: string, kind: NodeKind): RichWorkflowNode =>
  ({ id, kind, name: id, data: { id, name: id, kind }, position: { x: 0, y: 0 } }) as RichWorkflowNode;

const conditionNode = (
  id: string,
  branches: ConditionBranches,
): RichWorkflowNode =>
  ({
    id,
    kind: NodeKind.Condition,
    name: id,
    data: { id, name: id, kind: NodeKind.Condition, branches },
    position: { x: 0, y: 0 },
  }) as RichWorkflowNode;

const edge = (
  source: string,
  target: string,
  sourceHandle?: string,
): RichWorkflowEdge => ({ id: `${source}-${target}`, source, target, sourceHandle });

const branches: ConditionBranches = {
  if: { id: "if-1", type: "if", conditions: [], logicalOperator: "AND" },
  elseIf: [{ id: "elif-1", type: "elseIf", conditions: [], logicalOperator: "AND" }],
  else: { id: "else-1", type: "else", conditions: [], logicalOperator: "AND" },
};

describe("buildAdjacency", () => {
  it("records children and parents", () => {
    const nodes = [node("a", NodeKind.Input), node("b", NodeKind.LLM)];
    const { childrenOf, parentsOf } = buildAdjacency(nodes, [edge("a", "b")]);
    expect(childrenOf.get("a")).toEqual(["b"]);
    expect(parentsOf.get("b")).toEqual(["a"]);
    expect(childrenOf.get("b")).toEqual([]);
  });

  it("ignores an edge whose endpoint is not in the node list", () => {
    const nodes = [node("a", NodeKind.Input)];
    const { childrenOf } = buildAdjacency(nodes, [edge("a", "ghost")]);
    expect(childrenOf.get("a")).toEqual([]);
  });
});

describe("executableNodes", () => {
  it("drops Note nodes, which are comments and not steps", () => {
    const nodes = [node("a", NodeKind.Input), node("n", NodeKind.Note)];
    expect(executableNodes(nodes).map((n) => n.id)).toEqual(["a"]);
  });
});

describe("findEntryNodes", () => {
  it("returns the Input node even when other nodes have no parents", () => {
    const nodes = [node("in", NodeKind.Input), node("orphan", NodeKind.LLM)];
    const { parentsOf } = buildAdjacency(nodes, []);
    expect(findEntryNodes(nodes, parentsOf)).toEqual(["in"]);
  });

  it("falls back to every zero-in-degree node when there is no Input node", () => {
    const nodes = [node("a", NodeKind.LLM), node("b", NodeKind.Http)];
    const { parentsOf } = buildAdjacency(nodes, []);
    expect(findEntryNodes(nodes, parentsOf)).toEqual(["a", "b"]);
  });

  it("returns an empty list for an empty workflow", () => {
    expect(findEntryNodes([], new Map())).toEqual([]);
  });
});

describe("findTerminalNodes", () => {
  it("returns Output nodes", () => {
    const nodes = [node("a", NodeKind.LLM), node("out", NodeKind.Output)];
    const { childrenOf } = buildAdjacency(nodes, [edge("a", "out")]);
    expect(findTerminalNodes(nodes, childrenOf)).toEqual(["out"]);
  });

  it("falls back to zero-out-degree nodes, excluding Condition nodes", () => {
    const nodes = [
      node("a", NodeKind.LLM),
      node("b", NodeKind.Http),
      conditionNode("c", branches),
    ];
    const { childrenOf } = buildAdjacency(nodes, [edge("a", "b")]);
    expect(findTerminalNodes(nodes, childrenOf)).toEqual(["b"]);
  });

  it("returns an empty list for an empty workflow", () => {
    expect(findTerminalNodes([], new Map())).toEqual([]);
  });
});

describe("conditionEdgeTargets", () => {
  it("maps each branch id to the target of its own handle", () => {
    const c = conditionNode("c", branches);
    const edges = [
      edge("c", "a", "if-1"),
      edge("c", "b", "elif-1"),
      edge("c", "d", "else-1"),
    ];
    expect(conditionEdgeTargets(c, edges)).toEqual({
      "if-1": "a",
      "elif-1": "b",
      "else-1": "d",
    });
  });

  it("omits a branch that has no outgoing edge", () => {
    const c = conditionNode("c", branches);
    expect(conditionEdgeTargets(c, [edge("c", "a", "if-1")])).toEqual({ "if-1": "a" });
  });

  it("treats a legacy handle-less edge as the else branch", () => {
    const c = conditionNode("c", branches);
    expect(conditionEdgeTargets(c, [edge("c", "d")])).toEqual({ "else-1": "d" });
  });

  it("treats a legacy \"right\" handle as the else branch", () => {
    const c = conditionNode("c", branches);
    expect(conditionEdgeTargets(c, [edge("c", "d", "right")])).toEqual({ "else-1": "d" });
  });

  it("ignores edges from other nodes", () => {
    const c = conditionNode("c", branches);
    expect(conditionEdgeTargets(c, [edge("other", "d", "if-1")])).toEqual({});
  });

  it("returns an empty map when the node has no branches", () => {
    const c = { ...conditionNode("c", branches), data: { kind: NodeKind.Condition } } as RichWorkflowNode;
    expect(conditionEdgeTargets(c, [edge("c", "d")])).toEqual({});
  });
});
