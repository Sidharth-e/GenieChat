import { Connection } from "@xyflow/react";

/**
 * Check if adding a new connection would create a cycle in the graph.
 * Uses DFS with a recursion stack to detect back edges.
 */
export function wouldCreateCycle(
  newConnection: Connection,
  existingEdges: Connection[]
): boolean {
  const adj = new Map<string, string[]>();

  for (const edge of existingEdges) {
    if (!edge.source || !edge.target) continue;
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }

  if (!newConnection.source || !newConnection.target) return false;
  if (!adj.has(newConnection.source)) adj.set(newConnection.source, []);
  adj.get(newConnection.source)!.push(newConnection.target);

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    inStack.add(node);

    for (const neighbor of adj.get(node) || []) {
      if (inStack.has(neighbor)) return true;
      if (!visited.has(neighbor) && dfs(neighbor)) return true;
    }

    inStack.delete(node);
    return false;
  }

  for (const node of adj.keys()) {
    if (!visited.has(node) && dfs(node)) return true;
  }

  return false;
}
