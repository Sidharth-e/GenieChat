import type { RichWorkflowEdge, RichWorkflowNode } from "@/lib/types";
import { NodeKind, type ConditionNodeData } from "./types";
import { allConditionBranches } from "./resolve";

/**
 * The source handle a Condition node had before per-branch handles existed, and
 * the handle React Flow reports for an edge drawn without one. Both mean ELSE.
 */
export const DEFAULT_BRANCH_HANDLE = "right";

/** Children and parents for every node, in the order the edges were stored. */
export function buildAdjacency(
  nodes: RichWorkflowNode[],
  edges: RichWorkflowEdge[],
): {
  childrenOf: Map<string, string[]>;
  parentsOf: Map<string, string[]>;
} {
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  for (const node of nodes) {
    childrenOf.set(node.id, []);
    parentsOf.set(node.id, []);
  }
  for (const edge of edges) {
    if (!childrenOf.has(edge.source) || !childrenOf.has(edge.target)) continue;
    childrenOf.get(edge.source)!.push(edge.target);
    parentsOf.get(edge.target)!.push(edge.source);
  }
  return { childrenOf, parentsOf };
}

/** Note nodes are comments on the canvas, not steps: they never enter the graph. */
export function executableNodes(nodes: RichWorkflowNode[]): RichWorkflowNode[] {
  return nodes.filter((candidate) => candidate.data.kind !== NodeKind.Note);
}

/**
 * Where the run starts. The Input node is the entry whenever one exists —
 * including when it has inbound edges, which would otherwise make it look
 * unreachable — and the zero-in-degree nodes are the fallback for a workflow
 * with no Input node.
 */
export function findEntryNodes(
  nodes: RichWorkflowNode[],
  parentsOf: Map<string, string[]>,
): string[] {
  const input = nodes.find((candidate) => candidate.data.kind === NodeKind.Input);
  if (input) return [input.id];
  return executableNodes(nodes)
    .filter((candidate) => (parentsOf.get(candidate.id)?.length ?? 0) === 0)
    .map((candidate) => candidate.id);
}

/**
 * Where the run ends. Output nodes terminate unconditionally — they are the
 * workflow's declared result, so an Output node with an outgoing edge still
 * ends the run. With no Output node, the zero-out-degree nodes terminate; a
 * Condition node is excluded because its conditional edges already route
 * unwired branches to END.
 */
export function findTerminalNodes(
  nodes: RichWorkflowNode[],
  childrenOf: Map<string, string[]>,
): string[] {
  const outputs = executableNodes(nodes).filter(
    (candidate) => candidate.data.kind === NodeKind.Output,
  );
  if (outputs.length > 0) return outputs.map((candidate) => candidate.id);
  return executableNodes(nodes)
    .filter((candidate) => candidate.data.kind !== NodeKind.Condition)
    .filter((candidate) => (childrenOf.get(candidate.id)?.length ?? 0) === 0)
    .map((candidate) => candidate.id);
}

/**
 * Map branch id → the node that branch routes to, read from the outgoing
 * edges' `sourceHandle`. A branch with no outgoing edge is absent from the map;
 * `buildWorkflowGraph` supplies END for the gaps so the router always has a key
 * to return.
 *
 * Edges stored before per-branch handles existed carry `"right"` or nothing,
 * which can only ever have meant the ELSE branch — that was the only source
 * handle a Condition node had.
 */
export function conditionEdgeTargets(
  node: RichWorkflowNode,
  edges: RichWorkflowEdge[],
): Record<string, string> {
  const branches = (node.data as ConditionNodeData).branches;
  const outgoing = edges.filter((candidate) => candidate.source === node.id);
  const mapping: Record<string, string> = {};

  for (const branch of allConditionBranches(branches)) {
    const byHandle = outgoing.find((candidate) => candidate.sourceHandle === branch.id);
    if (byHandle) {
      mapping[branch.id] = byHandle.target;
      continue;
    }
    if (branch.type === "else") {
      const legacy = outgoing.find(
        (candidate) =>
          !candidate.sourceHandle || candidate.sourceHandle === DEFAULT_BRANCH_HANDLE,
      );
      if (legacy) mapping[branch.id] = legacy.target;
    }
  }
  return mapping;
}
