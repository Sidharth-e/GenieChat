import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RichWorkflowNode, ToolCall } from "@/lib/types";
import { WORKFLOW_HTTP_TIMEOUT_MS } from "@/constants/workflow";
import {
  NodeKind,
  type CodeNodeData,
  type ConditionNodeData,
  type HttpNodeData,
  type LLMNodeData,
  type OutputNodeData,
  type TemplateNodeData,
  type WorkflowToolKey,
} from "./types";
import {
  resolveTipTapContent,
  resolveValue,
  routeCondition,
  type WorkflowOutputs,
} from "./resolve";

/** What one node contributes: its value, plus what the record should show. */
export type NodeResult = {
  output: unknown;
  tokens?: { prompt: number; completion: number };
  toolCalls?: ToolCall[];
};

/**
 * Everything a node needs that is not the workflow itself. Injected rather than
 * imported so this module stays free of `config`/`env` and testable, and so the
 * service can close the run's owner over `loadTool`.
 */
export type WorkflowDeps = {
  getModel(modelId: string): BaseChatModel;
  loadTool(
    key: WorkflowToolKey,
  ): Promise<StructuredToolInterface | undefined>;
};

export type WorkflowStateValue = {
  query: Record<string, unknown>;
  outputs: WorkflowOutputs;
};

export type NodeInput = {
  state: WorkflowStateValue;
  /** This node's predecessors, in edge order — what an Output node falls back to. */
  parents: string[];
};

/** Run one node. Throws on failure; the caller decides what a failure means. */
export async function runNode(
  node: RichWorkflowNode,
  input: NodeInput,
  deps: WorkflowDeps,
): Promise<NodeResult> {
  const { state, parents } = input;

  switch (node.data.kind) {
    case NodeKind.Input:
      return { output: state.query };

    case NodeKind.Output: {
      const data = node.data as OutputNodeData;
      const result: Record<string, unknown> = {};
      for (const item of data.outputData ?? []) {
        if (item.source) {
          result[item.key] = resolveValue(item.source, state.outputs);
        }
      }
      if (Object.keys(result).length > 0) return { output: result };
      return { output: parents[0] ? state.outputs[parents[0]] : undefined };
    }

    case NodeKind.LLM:
      return executeLLMNode(node.data as LLMNodeData, state.outputs, deps);

    case NodeKind.Http:
      return { output: await executeHTTPNode(node.data as HttpNodeData, state.outputs) };

    case NodeKind.Template: {
      const data = node.data as TemplateNodeData;
      return { output: { text: resolveTipTapContent(data.template?.tiptap, state.outputs) } };
    }

    case NodeKind.Condition: {
      const data = node.data as ConditionNodeData;
      // The routing decision is *recorded* here and *read* by the conditional
      // edge in build-graph, so the conditions are evaluated exactly once.
      return { output: routeCondition(data.branches, state.outputs) };
    }

    case NodeKind.Code:
      return executeCodeNode(node, deps);

    default:
      throw new Error(
        `Unsupported node kind "${node.data.kind}" on node "${node.name || node.id}".`,
      );
  }
}

/**
 * Build messages from the node's TipTap content and stream the model. A message
 * that resolves to whitespace only is dropped; if every message drops, the node
 * fails naming itself rather than sending an empty prompt.
 */
async function executeLLMNode(
  data: LLMNodeData,
  outputs: WorkflowOutputs,
  deps: WorkflowDeps,
): Promise<NodeResult> {
  const messages: BaseMessage[] = (data.messages ?? [])
    .map((msg) => {
      const text = resolveTipTapContent(msg.content, outputs);
      if (!text.trim()) return null;
      switch (msg.role) {
        case "system":
          return new SystemMessage(text);
        case "assistant":
          return new AIMessage(text);
        default:
          return new HumanMessage(text);
      }
    })
    .filter((m): m is SystemMessage | AIMessage | HumanMessage => m !== null);

  if (messages.length === 0) {
    throw new Error(
      `LLM node "${data.name}" has no message content. Add text or variable references to at least one message.`,
    );
  }

  // The model is built only once the node is known to be runnable: a node with
  // no usable message content can never succeed, so constructing a provider
  // client for it would be pure waste (and would demand config it does not need).
  const model = deps.getModel(data.model.model);

  let fullResponse = "";
  let finalChunk: AIMessageChunk | null = null;
  const stream = await model.stream(messages);
  for await (const chunk of stream) {
    finalChunk = finalChunk ? finalChunk.concat(chunk) : chunk;
    if (chunk.text) fullResponse += chunk.text;
  }

  const usageMeta = finalChunk?.usage_metadata;
  const tokens = usageMeta
    ? { prompt: usageMeta.input_tokens ?? 0, completion: usageMeta.output_tokens ?? 0 }
    : undefined;

  // When the node declares an output schema, prefer the model's JSON, and fall
  // back to wrapping the raw text under the schema's first key.
  if (data.outputSchema?.properties) {
    try {
      return { output: JSON.parse(fullResponse), tokens };
    } catch {
      const firstKey = Object.keys(data.outputSchema.properties)[0];
      if (firstKey) return { output: { [firstKey]: fullResponse }, tokens };
    }
  }
  return { output: { answer: fullResponse }, tokens };
}

async function executeHTTPNode(
  data: HttpNodeData,
  outputs: WorkflowOutputs,
): Promise<unknown> {
  const url = resolveValue(data.url, outputs);
  if (!url) throw new Error("HTTP node: URL is empty");

  const queryParams = new URLSearchParams();
  for (const q of data.query ?? []) {
    if (q.key && q.value !== undefined) {
      queryParams.set(q.key, resolveValue(q.value, outputs));
    }
  }
  const queryString = queryParams.toString();
  const fullUrl = queryString ? `${url}?${queryString}` : url;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const h of data.headers ?? []) {
    if (h.key && h.value !== undefined) {
      headers[h.key] = resolveValue(h.value, outputs);
    }
  }

  let body: string | undefined;
  if (data.body && data.method !== "GET" && data.method !== "HEAD") {
    body = resolveValue(data.body, outputs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    data.timeout || WORKFLOW_HTTP_TIMEOUT_MS,
  );

  try {
    const response = await fetch(fullUrl, {
      method: data.method,
      headers,
      body,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const responseData: unknown = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    return { status: response.status, data: responseData };
  } finally {
    clearTimeout(timeout);
  }
}

/** The shape `code_sandbox` returns, parsed from its JSON string. */
type CodeSandboxResult = {
  stdout?: string;
  stderr?: string;
  exit_code?: number | null;
  files?: string[];
  error?: string;
};

/**
 * Run the node's script in the sandbox and surface its result as the node's
 * output. A non-zero exit is a failure, not a success with a non-zero field:
 * a workflow whose script broke should stop where it broke.
 */
async function executeCodeNode(
  node: RichWorkflowNode,
  deps: WorkflowDeps,
): Promise<NodeResult> {
  const label = node.name || node.id;
  const data = node.data as CodeNodeData;

  if (!data.code?.trim()) {
    throw new Error(`Code node "${label}" has no code to run.`);
  }

  const tool = await deps.loadTool({
    id: "code_sandbox",
    description: "",
    type: "app-tool",
  });
  if (!tool) {
    throw new Error(
      `Code node "${label}": the code sandbox is not available. Check the deployment's sandbox configuration.`,
    );
  }

  const raw = await tool.invoke({
    code: data.code,
    language: data.language ?? "python",
  });

  let parsed: CodeSandboxResult;
  try {
    parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as CodeSandboxResult;
  } catch {
    throw new Error(`Code node "${label}": the sandbox returned an unreadable result.`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Code node "${label}": the sandbox returned an unreadable result.`);
  }

  if (parsed.error) {
    throw new Error(`Code node "${label}" failed: ${parsed.error}`);
  }

  const exitCode = parsed.exit_code ?? 0;
  if (exitCode !== 0) {
    const detail = (parsed.stderr || parsed.stdout || "").trim();
    throw new Error(
      `Code node "${label}" exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }

  return {
    output: {
      stdout: parsed.stdout ?? "",
      stderr: parsed.stderr ?? "",
      exit_code: exitCode,
      files: parsed.files ?? [],
    },
  };
}
