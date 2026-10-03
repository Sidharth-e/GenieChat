import { GraphRecursionError, UnreachableNodeError } from "@langchain/langgraph";
import { WORKFLOW_RECURSION_LIMIT } from "@/constants/workflow";

/**
 * A node or run failure, as a sentence a person can act on.
 *
 * The recursion case is special-cased because the graph did nothing wrong: it
 * hit the bound this app set. LangGraph's own text names a limit the user never
 * chose and never saw, so this replaces it with the limit *and* the likely
 * cause.
 *
 * The unreachable case is special-cased for the opposite reason: the graph
 * builder adds a node for every executable node, so a node left unconnected on
 * the canvas compiles to a node no edge reaches — which LangGraph reports by
 * naming an internal id the user never sees. Matching the error *type* rather
 * than parsing the library's message is deliberate; the translation is generic
 * and names no node.
 */
export function describeError(error: unknown): string {
  if (error instanceof GraphRecursionError) {
    return `Workflow exceeded the step limit (${WORKFLOW_RECURSION_LIMIT}). Check for a loop that never exits.`;
  }
  if (error instanceof UnreachableNodeError) {
    return "This workflow has a node that is not connected to the rest of the workflow. Connect it, or remove it.";
  }
  return error instanceof Error ? error.message : String(error);
}
