import { Edge } from "@xyflow/react";
import type { RichWorkflowEdge, RichWorkflowNode } from "@/lib/types";
import {
  NodeKind,
  type UINode,
  type LLMNodeData,
  type HttpNodeData,
  type ToolNodeData,
  type CodeNodeData,
} from "./types";

interface ValidationResult {
  errorMessage: string;
  node?: UINode;
}

/**
 * Validate all nodes in a workflow before publishing.
 * Returns true if valid, or a ValidationResult with the first error found.
 */
export function allNodeValidate({
  nodes,
  edges,
}: {
  nodes: UINode[];
  edges: Edge[];
}): true | ValidationResult {
  // Must have Input node
  const inputNode = nodes.find((n) => n.data.kind === NodeKind.Input);
  if (!inputNode) {
    return { errorMessage: "Workflow must have an Input node" };
  }

  // Must have Output node
  const outputNode = nodes.find((n) => n.data.kind === NodeKind.Output);
  if (!outputNode) {
    return { errorMessage: "Workflow must have an Output node" };
  }

  // Validate individual nodes
  for (const node of nodes) {
    if (node.data.kind === NodeKind.LLM) {
      const data = node.data as LLMNodeData;
      if (!data.model) {
        return {
          errorMessage: `LLM node "${node.data.name}" must have a model selected`,
          node,
        };
      }
      if (!data.messages?.length) {
        return {
          errorMessage: `LLM node "${node.data.name}" must have at least one message`,
          node,
        };
      }
    }

    if (node.data.kind === NodeKind.Http) {
      const data = node.data as HttpNodeData;
      if (!data.url) {
        return {
          errorMessage: `HTTP node "${node.data.name}" must have a URL`,
          node,
        };
      }
    }

    if (node.data.kind === NodeKind.Tool) {
      const data = node.data as ToolNodeData;
      if (!data.tool) {
        return {
          errorMessage: `Tool node "${node.data.name}" must have a tool selected`,
          node,
        };
      }
    }

    if (node.data.kind === NodeKind.Code) {
      const data = node.data as CodeNodeData;
      if (!data.code?.trim()) {
        return {
          errorMessage: `Code node "${node.data.name}" must have code to run`,
          node,
        };
      }
    }
  }

  // Check for disconnected non-note nodes
  const connectedNodeIds = new Set<string>();
  connectedNodeIds.add(inputNode.id);
  edges.forEach((e) => {
    connectedNodeIds.add(e.source);
    connectedNodeIds.add(e.target);
  });

  for (const node of nodes) {
    if (node.data.kind === NodeKind.Note) continue;
    if (!connectedNodeIds.has(node.id)) {
      return {
        errorMessage: `Node "${node.data.name}" is disconnected from the workflow`,
        node,
      };
    }
  }

  return true;
}

/**
 * The run-time guard, deliberately weaker than `allNodeValidate`: a workflow
 * being built should be runnable long before it is publishable, so the missing
 * Output node and the unset optional fields that block publishing do not block
 * a run. It rejects only the shapes that cannot produce a run at all, and it
 * answers with a sentence the run's error can carry verbatim.
 */
export function runnableProblem({
  nodes,
  edges,
}: {
  nodes: RichWorkflowNode[];
  edges: RichWorkflowEdge[];
}): string | null {
  const executable = nodes.filter((node) => node.data.kind !== NodeKind.Note);

  if (executable.length === 0) {
    return "This workflow has no steps yet. Add a node before running it.";
  }

  if (executable.length > 1 && edges.length === 0) {
    return "This workflow's nodes are not connected. Connect them before running it.";
  }

  return null;
}
