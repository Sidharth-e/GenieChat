import { END, START, StateGraph } from "@langchain/langgraph";
import type { RichWorkflow, RichWorkflowNode } from "@/lib/types";
import { NodeKind, type ConditionNodeData } from "./types";
import { WorkflowState } from "./state";
import { runNode, type NodeResult, type WorkflowDeps } from "./executors";
import {
  buildAdjacency,
  conditionEdgeTargets,
  executableNodes,
  findEntryNodes,
  findTerminalNodes,
} from "./graph";
import { allConditionBranches } from "./resolve";

/**
 * Observers for the run. The node wrapper calls these around `runNode`, which
 * is how the service turns a graph execution into NODE_START / NODE_END events
 * and execution-record writes without the graph builder knowing about either.
 */
export type WorkflowHooks = {
  onNodeStart?: (node: RichWorkflowNode, executionId: string) => void;
  onNodeEnd?: (node: RichWorkflowNode, result: NodeResult, executionId: string) => void;
  onNodeError?: (node: RichWorkflowNode, error: unknown, executionId: string) => void;
};

/**
 * A workflow's node names are whatever ids the stored definition carries, so the
 * graph is typed with `string` for its node-name parameter rather than the
 * literal `typeof START` that `new StateGraph(WorkflowState)` infers. Without
 * this the builder rejects every `node.id` it is handed, because the inferred
 * name union has not yet been widened by any `addNode` call.
 */
type WorkflowGraph = StateGraph<
  typeof WorkflowState,
  typeof WorkflowState.State,
  typeof WorkflowState.Update,
  string
>;

/**
 * Turn a stored workflow definition into a LangGraph.
 *
 * Nothing here is persisted: the workflow's `nodes` + `edges` *are* the
 * definition, so the graph is rebuilt from the database on every run. The
 * returned graph is uncompiled — compiling is the caller's step, and the place
 * a checkpointer would be attached if one is ever wanted.
 */
export function buildWorkflowGraph(
  workflow: RichWorkflow,
  deps: WorkflowDeps,
  hooks: WorkflowHooks = {},
): WorkflowGraph {
  const nodes = executableNodes(workflow.nodes);
  const { childrenOf, parentsOf } = buildAdjacency(nodes, workflow.edges);
  const known = new Set(nodes.map((candidate) => candidate.id));
  const graph: WorkflowGraph = new StateGraph(WorkflowState);

  for (const node of nodes) {
    graph.addNode(node.id, async (state: typeof WorkflowState.State) => {
      const executionId = crypto.randomUUID();
      hooks.onNodeStart?.(node, executionId);
      try {
        const result = await runNode(
          node,
          {
            state: { query: state.query, outputs: state.outputs },
            parents: parentsOf.get(node.id) ?? [],
          },
          deps,
        );
        hooks.onNodeEnd?.(node, result, executionId);
        return { outputs: { [node.id]: result.output } };
      } catch (error) {
        // Report, then rethrow: a failed node stops the run. Continuing would
        // leave every downstream node resolving against a value that was never
        // produced, which reads as success and is worse than a visible stop.
        hooks.onNodeError?.(node, error, executionId);
        throw error;
      }
    });
  }

  for (const node of nodes) {
    if (node.data.kind === NodeKind.Condition) {
      const mapping = conditionEdgeTargets(node, workflow.edges);
      // A branch drawn to a node that never entered the graph — a Note, or a
      // stale id — is unwired: LangGraph rejects an edge ending at an unknown
      // node, and a branch with nowhere to go is what END is for. This mirrors
      // the plain-edge `known.has(target)` guard below.
      for (const [id, target] of Object.entries(mapping)) {
        if (target !== END && !known.has(target)) mapping[id] = END;
      }
      // Every branch the router can return needs an entry, or LangGraph rejects
      // the edge. An unwired branch routes to END — the run simply stops there.
      for (const branch of allConditionBranches((node.data as ConditionNodeData).branches)) {
        if (!(branch.id in mapping)) mapping[branch.id] = END;
      }
      graph.addConditionalEdges(
        node.id,
        (state: typeof WorkflowState.State) => {
          const recorded = state.outputs[node.id] as { branchId?: string } | undefined;
          return recorded?.branchId ?? END;
        },
        mapping,
      );
      continue;
    }

    // More than one target is fan-out, not a problem: LangGraph runs them in
    // the same super-step, which is the parallelism the sequential
    // topological-sort executor could not express.
    for (const target of childrenOf.get(node.id) ?? []) {
      if (known.has(target)) graph.addEdge(node.id, target);
    }
  }

  for (const entry of findEntryNodes(workflow.nodes, parentsOf)) {
    graph.addEdge(START, entry);
  }
  for (const terminal of findTerminalNodes(workflow.nodes, childrenOf)) {
    graph.addEdge(terminal, END);
  }

  return graph;
}
