/**
 * Workflow execution limits and defaults.
 *
 * `WORKFLOW_RECURSION_LIMIT` bounds a run's super-steps. LangGraph raises
 * `GraphRecursionError` on the step after this many, which is the only thing
 * that stops a cycle that never exits. 100 matches the four existing LangGraph
 * call sites in this repo.
 */
export const WORKFLOW_RECURSION_LIMIT = 100;

/** Per-request timeout for an HTTP node, when the node sets none. */
export const WORKFLOW_HTTP_TIMEOUT_MS = 30_000;
