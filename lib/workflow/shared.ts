import { Edge } from "@xyflow/react";
import type {
  WorkflowNodeData,
  OutputSchemaSourceKey,
  ObjectJsonSchema7,
  JsonSchema7,
} from "./types";

/**
 * Find all node IDs that are accessible predecessors of the given node.
 * Walks backward through edges to find all upstream nodes whose output
 * can be referenced by the given node.
 */
export function findAccessibleNodeIds({
  nodeId,
  nodes,
  edges,
}: {
  nodeId: string;
  nodes: WorkflowNodeData[];
  edges: Edge[];
}): string[] {
  const visited = new Set<string>();
  const queue: string[] = [];

  const reverseAdj = new Map<string, string[]>();
  nodes.forEach((n) => reverseAdj.set(n.id, []));
  edges.forEach((e) => {
    reverseAdj.get(e.target)?.push(e.source);
  });

  queue.push(nodeId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of reverseAdj.get(current) || []) {
      if (!visited.has(parent)) queue.push(parent);
    }
  }

  visited.delete(nodeId);
  return Array.from(visited);
}

/**
 * Traverse a JSON Schema by path segments to find a nested schema.
 * e.g., findJsonSchemaByPath(schema, ["result", "data"]) finds schema.properties.result.properties.data
 */
export function findJsonSchemaByPath(
  schema: ObjectJsonSchema7 | undefined,
  path: string[]
): JsonSchema7 | undefined {
  if (!schema || !path.length) return undefined;

  let current: JsonSchema7 | undefined = schema as unknown as JsonSchema7;
  for (const segment of path) {
    if (current?.properties?.[segment]) {
      current = current.properties[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Resolve a variable reference (OutputSchemaSourceKey) to its display info.
 * Returns the source node name, path, type, and whether the reference is broken.
 */
export function findAvailableSchemaBySource({
  source,
  nodes,
}: {
  nodeId: string;
  source: OutputSchemaSourceKey;
  nodes: WorkflowNodeData[];
  edges: Edge[];
}): {
  nodeName: string;
  path: string[];
  type?: string;
  notFound?: boolean;
} {
  const sourceNode = nodes.find((n) => n.id === source.nodeId);
  if (!sourceNode) {
    return { nodeName: "Not Found", path: source.path, notFound: true };
  }

  const schema = findJsonSchemaByPath(sourceNode.outputSchema, source.path);
  return {
    nodeName: sourceNode.name,
    path: source.path,
    type: schema?.type,
    notFound: !schema,
  };
}
