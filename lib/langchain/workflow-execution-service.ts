import "server-only";

import { logger } from "@/lib/logger";
import type { MCPServerConfig, RichWorkflow, WorkflowExecutionStep } from "../types";
import { isDatabaseConfigured } from "../mongodb/client";
import { MCPStore } from "../mongodb/mcp-store";
import { WorkflowStore } from "../mongodb/workflow-store";
import { buildWorkflowGraph, type WorkflowHooks } from "@/lib/workflow/build-graph";
import { describeError } from "@/lib/workflow/errors";
import type { NodeResult, WorkflowDeps } from "@/lib/workflow/executors";
import { runnableProblem } from "@/lib/workflow/node-validate";
import type { WorkflowOutputs } from "@/lib/workflow/resolve";
import { NodeKind } from "@/lib/workflow/types";
import { WORKFLOW_RECURSION_LIMIT } from "@/constants/workflow";
import { getModel } from "./model-factory";
import { resolveWorkflowTool } from "./workflow-tool-resolver";

export interface RichWorkflowStreamEvent {
    eventType: "WORKFLOW_START" | "WORKFLOW_END" | "NODE_START" | "NODE_END";
    nodeId?: string;
    nodeExecutionId?: string;
    node?: { name: string };
    isOk?: boolean;
    output?: unknown;
    input?: unknown;
    error?: string;
    tokens?: { prompt: number; completion: number };
    executionId?: string;
}

const stringifyOutput = (value: unknown): string => {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

/** The workflow's declared result: the last Output node's value. */
function deriveFinalOutput(
  workflow: RichWorkflow,
  outputs: WorkflowOutputs,
): string | undefined {
  const outputNodes = workflow.nodes.filter(
    (node) => node.data.kind === NodeKind.Output,
  );
  const last = outputNodes[outputNodes.length - 1];
  if (!last) return undefined;
  const value = outputs[last.id];
  return value === undefined ? undefined : stringifyOutput(value);
}

/**
 * Runs a node-based workflow by compiling its stored definition into a
 * LangGraph. Nothing about the graph is persisted — `nodes` + `edges` in the
 * `workflows` collection *are* the definition, and the graph is rebuilt from
 * them on every run.
 */
export class WorkflowExecutionService {
  async *executeRichWorkflow(params: {
    workflow: RichWorkflow;
    query: Record<string, unknown>;
  }): AsyncGenerator<RichWorkflowStreamEvent> {
    const { workflow, query } = params;
    const startedAt = Date.now();

    const problem = runnableProblem({ nodes: workflow.nodes, edges: workflow.edges });
    if (problem) {
      yield { eventType: "WORKFLOW_END", isOk: false, error: problem };
      return;
    }

    const steps: WorkflowExecutionStep[] = workflow.nodes.map((node) => ({
      stepId: node.id,
      stepName: node.name || node.kind,
      status: "pending" as const,
    }));
    const stepIndexById = new Map(steps.map((step, index) => [step.stepId, index]));

    const store = isDatabaseConfigured() ? new WorkflowStore() : null;
    let executionId: string | undefined;

    if (store) {
      try {
        const execution = await store.createExecution({
          workflowId: workflow.id,
          userId: workflow.userId,
          userName: workflow.userName,
          userEmail: workflow.userEmail,
          title: workflow.name,
          status: "running",
          startTime: new Date().toISOString(),
          steps,
          currentStepIndex: 0,
          initialInput: JSON.stringify(query),
        });
        executionId = execution.id;
      } catch (err) {
        logger.error({ err }, "Failed to create rich workflow execution record");
      }
    }

    let mcpServers: MCPServerConfig[] = [];
    try {
      mcpServers = await new MCPStore().getMCPServers(workflow.userId);
    } catch (err) {
      logger.warn({ err }, "Failed to load MCP servers for a workflow run");
    }

    const deps: WorkflowDeps = {
      getModel: (modelId) => getModel(modelId),
      loadTool: (key) => resolveWorkflowTool(key, { userId: workflow.userId, mcpServers }),
    };

    // The graph runs as one promise; the hooks below append events to this
    // array and wake the drain loop. That keeps the generator yielding while
    // the run is still in flight, so the canvas shows node status live.
    const events: RichWorkflowStreamEvent[] = [];
    let wake: (() => void) | null = null;
    const push = (event: RichWorkflowStreamEvent) => {
      events.push(event);
      wake?.();
      wake = null;
    };

    const patchStep = (stepId: string, patch: Partial<WorkflowExecutionStep>) => {
      const index = stepIndexById.get(stepId);
      if (index === undefined) return;
      steps[index] = { ...steps[index], ...patch };
    };

    const hooks: WorkflowHooks = {
      onNodeStart: (node, nodeExecutionId) => {
        patchStep(node.id, {
          status: "running",
          startTime: new Date().toISOString(),
        });
        push({
          eventType: "NODE_START",
          nodeId: node.id,
          nodeExecutionId,
          node: { name: node.name || node.id },
        });
      },
      onNodeEnd: (node, result: NodeResult, nodeExecutionId) => {
        patchStep(node.id, {
          status: "completed",
          endTime: new Date().toISOString(),
          output: stringifyOutput(result.output),
          tokens: result.tokens,
          toolCalls: result.toolCalls,
        });
        push({
          eventType: "NODE_END",
          nodeId: node.id,
          nodeExecutionId,
          node: { name: node.name || node.id },
          isOk: true,
          output: result.output,
          tokens: result.tokens,
        });
      },
      onNodeError: (node, error, nodeExecutionId) => {
        const message = describeError(error);
        patchStep(node.id, {
          status: "error",
          endTime: new Date().toISOString(),
          error: message,
        });
        push({
          eventType: "NODE_END",
          nodeId: node.id,
          nodeExecutionId,
          node: { name: node.name || node.id },
          isOk: false,
          error: message,
        });
      },
    };

    let settled = false;
    let failure: unknown;
    let finalState: { outputs: WorkflowOutputs } | undefined;

    const finish = () => {
      settled = true;
      wake?.();
      wake = null;
    };

    // `compile()` validates the graph and throws *synchronously* when a node is
    // unreachable, so the graph must be built inside the promise: `.then`'s
    // rejection handler is what routes a failure — including that one — into
    // `describeError` and a WORKFLOW_END. Left outside, the throw would escape
    // the generator instead and the user would see LangGraph's raw message.
    void (async () =>
      buildWorkflowGraph(workflow, deps, hooks)
        .compile()
        .invoke({ query }, { recursionLimit: WORKFLOW_RECURSION_LIMIT })
    )().then(
      (result) => {
        finalState = result as { outputs: WorkflowOutputs };
        finish();
      },
      (error: unknown) => {
        failure = error;
        finish();
      },
    );

    yield { eventType: "WORKFLOW_START", executionId };

    while (!settled || events.length > 0) {
      if (events.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      const event = events.shift()!;

      // Persisted from the drain loop rather than from the hooks, so the whole
      // `steps` array is written once per emitted event and never out of order.
      if (executionId && store) {
        try {
          await store.updateExecution(executionId, workflow.id, { steps });
        } catch (err) {
          logger.warn({ err }, "Failed to record rich workflow execution step");
        }
      }

      yield event;
    }

    const errorMessage = failure ? describeError(failure) : undefined;

    // Fail-fast leaves later nodes `pending` (correct — they never ran) but can
    // leave a node `running` if the graph was aborted mid-flight. Nothing may
    // stay in that state once the run is over.
    for (const step of steps) {
      if (step.status === "running") {
        step.status = "error";
        step.endTime = new Date().toISOString();
        step.error = errorMessage ?? "Execution stopped before this node finished.";
      }
    }

    const totals = steps.reduce(
      (acc, step) => {
        if (step.tokens) {
          acc.prompt += step.tokens.prompt;
          acc.completion += step.tokens.completion;
        }
        return acc;
      },
      { prompt: 0, completion: 0 },
    );

    const finalOutput = finalState
      ? deriveFinalOutput(workflow, finalState.outputs)
      : undefined;

    if (executionId && store) {
      try {
        await store.updateExecution(executionId, workflow.id, {
          status: errorMessage ? "error" : "completed",
          endTime: new Date().toISOString(),
          duration: Math.round((Date.now() - startedAt) / 1000),
          steps,
          finalOutput,
          error: errorMessage,
          tokenUsage:
            totals.prompt + totals.completion > 0
              ? { ...totals, total: totals.prompt + totals.completion }
              : undefined,
        });
      } catch (err) {
        logger.warn({ err }, "Failed to finalize rich workflow execution");
      }
    }

    yield { eventType: "WORKFLOW_END", isOk: !errorMessage, error: errorMessage };
  }
}

// Singleton instance
export const workflowExecutionService = new WorkflowExecutionService();
