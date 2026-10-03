import { Annotation } from "@langchain/langgraph";
import type { WorkflowOutputs } from "./resolve";

/**
 * The graph state. `outputs` maps nodeId → that node's output value and is the
 * direct replacement for the `nodeOutputs` Map the sequential executor carried.
 *
 * The merging reducer is load-bearing, not decoration: with fan-out, two
 * branches returning `outputs` in the same super-step would otherwise clobber
 * each other, and the second node's value would silently vanish. It is also
 * what makes a cycle safe to allow.
 */
export const WorkflowState = Annotation.Root({
  query: Annotation<Record<string, unknown>>({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  outputs: Annotation<WorkflowOutputs>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});
