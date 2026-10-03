import { describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import {
  runNode,
  summarizeAgentRun,
  type NodeInput,
  type WorkflowDeps,
} from "@/lib/workflow/executors";
import { NodeKind } from "@/lib/workflow/types";
import type { TipTapMentionJsonContent } from "@/lib/workflow/types";
import type { RichWorkflowNode } from "@/lib/types";

const node = (id: string, kind: NodeKind, data: Record<string, unknown> = {}): RichWorkflowNode =>
  ({
    id,
    kind,
    name: id,
    data: { id, name: id, kind, outputSchema: { type: "object", properties: {} }, ...data },
    position: { x: 0, y: 0 },
  }) as RichWorkflowNode;

const textDoc = (text: string): TipTapMentionJsonContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const state = (outputs: Record<string, unknown> = {}, query: Record<string, unknown> = {}) => ({
  query,
  outputs,
});

const input = (outputs?: Record<string, unknown>, parents: string[] = []): NodeInput => ({
  state: state(outputs),
  parents,
});

const unusedDeps: WorkflowDeps = {
  getModel: () => {
    throw new Error("getModel should not be called by this node kind");
  },
  loadTool: async () => {
    throw new Error("loadTool should not be called by this node kind");
  },
};

const streamingModel = (chunks: string[]): BaseChatModel =>
  ({
    stream: async function* () {
      for (const chunk of chunks) yield new AIMessageChunk(chunk);
    },
  }) as unknown as BaseChatModel;

describe("runNode — Input", () => {
  it("returns the run query as its output", async () => {
    const result = await runNode(
      node("in", NodeKind.Input),
      { state: state({}, { topic: "birds" }), parents: [] },
      unusedDeps,
    );
    expect(result.output).toEqual({ topic: "birds" });
  });
});

describe("runNode — Output", () => {
  it("resolves each configured source", async () => {
    const output = node("out", NodeKind.Output, {
      outputData: [{ key: "summary", source: { nodeId: "llm", path: ["answer"] } }],
    });
    const result = await runNode(output, input({ llm: { answer: "done" } }), unusedDeps);
    expect(result.output).toEqual({ summary: "done" });
  });

  it("falls back to the first parent's output when nothing is configured", async () => {
    const output = node("out", NodeKind.Output, { outputData: [] });
    const result = await runNode(output, input({ tmpl: { text: "hi" } }, ["tmpl"]), unusedDeps);
    expect(result.output).toEqual({ text: "hi" });
  });

  it("is undefined when there is nothing to fall back to", async () => {
    const output = node("out", NodeKind.Output, { outputData: [] });
    const result = await runNode(output, input({}, []), unusedDeps);
    expect(result.output).toBeUndefined();
  });
});

describe("runNode — Template", () => {
  it("resolves the template to plain text", async () => {
    const template = node("t", NodeKind.Template, {
      template: { type: "tiptap", tiptap: textDoc("hello ") },
    });
    const result = await runNode(template, input(), unusedDeps);
    expect(result.output).toEqual({ text: "hello " });
  });
});

describe("runNode — Condition", () => {
  const branches = {
    if: {
      id: "if-1",
      type: "if" as const,
      conditions: [{ source: { nodeId: "n", path: [] }, operator: "eq", value: "a" }],
      logicalOperator: "AND" as const,
    },
    else: { id: "else-1", type: "else" as const, conditions: [], logicalOperator: "AND" as const },
  };

  it("records the winning branch as its output", async () => {
    const condition = node("c", NodeKind.Condition, { branches });
    const result = await runNode(condition, input({ n: "a" }), unusedDeps);
    expect(result.output).toEqual({ branchId: "if-1", branchType: "if" });
  });

  it("records else when nothing matches", async () => {
    const condition = node("c", NodeKind.Condition, { branches });
    const result = await runNode(condition, input({ n: "z" }), unusedDeps);
    expect(result.output).toEqual({ branchId: "else-1", branchType: "else" });
  });
});

describe("runNode — LLM", () => {
  const llmNode = (messages: unknown[]) =>
    node("llm", NodeKind.LLM, { model: { provider: "google", model: "test-model" }, messages });

  it("names the node when every message resolves to whitespace", async () => {
    const deps: WorkflowDeps = {
      getModel: () => streamingModel(["never reached"]),
      loadTool: unusedDeps.loadTool,
    };
    // A mention whose node never ran resolves to "", so the message is blank.
    const blank = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "mention", attrs: { id: "ghost.answer", label: "ghost" } }] },
      ],
    };
    await expect(
      runNode(llmNode([{ role: "user", content: blank }]), input(), deps),
    ).rejects.toThrow(/LLM node "llm" has no message content/);
  });

  it("returns the streamed text as { answer }", async () => {
    const deps: WorkflowDeps = {
      getModel: () => streamingModel(["hel", "lo"]),
      loadTool: unusedDeps.loadTool,
    };
    const result = await runNode(
      llmNode([{ role: "user", content: textDoc("hi") }]),
      input(),
      deps,
    );
    expect(result.output).toEqual({ answer: "hello" });
  });
});

describe("runNode — Http", () => {
  it("resolves the URL and query params and returns the parsed body", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const http = node("h", NodeKind.Http, {
      url: { nodeId: "n", path: ["base"] },
      method: "GET",
      headers: [],
      query: [{ key: "q", value: "birds" }],
    });
    const result = await runNode(http, input({ n: { base: "https://example.com" } }), unusedDeps);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com?q=birds",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.output).toEqual({ status: 200, data: { ok: true } });
    vi.unstubAllGlobals();
  });

  it("fails when the URL resolves to nothing", async () => {
    const http = node("h", NodeKind.Http, { url: undefined, method: "GET", headers: [], query: [] });
    await expect(runNode(http, input(), unusedDeps)).rejects.toThrow(/URL is empty/);
  });
});

describe("runNode — unsupported kinds", () => {
  it("throws naming the kind rather than returning an empty success", async () => {
    await expect(runNode(node("n", NodeKind.Note), input(), unusedDeps)).rejects.toThrow(
      /Unsupported node kind "note" on node "n"/,
    );
  });
});

describe("runNode — Code", () => {
  const codeNode = (data: Record<string, unknown> = {}) =>
    node("code", NodeKind.Code, { code: "print(1)", language: "python", ...data });

  const depsReturning = (result: unknown): WorkflowDeps => ({
    getModel: unusedDeps.getModel,
    loadTool: async () => ({ invoke: async () => result }) as never,
  });

  it("runs the sandbox and maps its result to the node output", async () => {
    const deps = depsReturning(
      JSON.stringify({ stdout: "1\n", stderr: "", exit_code: 0, files: ["a.txt"] }),
    );
    const result = await runNode(codeNode(), input(), deps);
    expect(result.output).toEqual({
      stdout: "1\n",
      stderr: "",
      exit_code: 0,
      files: ["a.txt"],
    });
  });

  it("passes the node's code and language to the tool", async () => {
    const invoke = vi.fn(async () => JSON.stringify({ stdout: "", exit_code: 0 }));
    const deps: WorkflowDeps = {
      getModel: unusedDeps.getModel,
      loadTool: async () => ({ invoke }) as never,
    };
    await runNode(codeNode({ code: "echo hi", language: "bash" }), input(), deps);
    expect(invoke).toHaveBeenCalledWith({ code: "echo hi", language: "bash" });
  });

  it("fails naming the node when there is no code", async () => {
    await expect(runNode(codeNode({ code: "  " }), input(), unusedDeps)).rejects.toThrow(
      /Code node "code" has no code to run/,
    );
  });

  it("fails when the sandbox reports an error", async () => {
    const deps = depsReturning(
      JSON.stringify({ stdout: "", exit_code: 0, error: "container unavailable" }),
    );
    await expect(runNode(codeNode(), input(), deps)).rejects.toThrow(
      /Code node "code" failed: container unavailable/,
    );
  });

  it("fails on a non-zero exit code rather than passing a broken script downstream", async () => {
    const deps = depsReturning(
      JSON.stringify({ stdout: "", stderr: "boom", exit_code: 1 }),
    );
    await expect(runNode(codeNode(), input(), deps)).rejects.toThrow(
      /Code node "code" exited with code 1: boom/,
    );
  });

  it("fails when the sandbox returns an unreadable result", async () => {
    await expect(runNode(codeNode(), input(), depsReturning("not json"))).rejects.toThrow(
      /returned an unreadable result/,
    );
  });
});

describe("summarizeAgentRun", () => {
  it("collects tool calls with their results and sums token usage", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call-1", name: "web_search", args: { query: "birds" } }],
        usage_metadata: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      }),
      new ToolMessage({ content: "3 results", tool_call_id: "call-1" }),
      new AIMessage({
        content: "Found three sources.",
        usage_metadata: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
      }),
    ];
    const result = summarizeAgentRun(messages);
    expect(result.toolCalls).toEqual([
      {
        id: "call-1",
        name: "web_search",
        arguments: { query: "birds" },
        result: "3 results",
      },
    ]);
    expect(result.output).toEqual({ answer: "Found three sources." });
    expect(result.tokens).toEqual({ prompt: 30, completion: 7 });
  });

  it("leaves tokens undefined when the model reported none", () => {
    expect(summarizeAgentRun([new AIMessage("hi")]).tokens).toBeUndefined();
  });
});

describe("runNode — Tool", () => {
  const toolNode = (tool?: Record<string, unknown>) =>
    node("tool", NodeKind.Tool, {
      model: { provider: "google", model: "test-model" },
      ...(tool ? { tool } : {}),
    });

  it("fails naming the node when no tool is selected", async () => {
    await expect(runNode(toolNode(), input(), unusedDeps)).rejects.toThrow(
      /Tool node "tool" has no tool selected/,
    );
  });

  it("names the connector when the tool cannot be loaded", async () => {
    const deps: WorkflowDeps = {
      getModel: unusedDeps.getModel,
      loadTool: async () => undefined,
    };
    const data = {
      id: "search",
      description: "Search",
      type: "connector-tool",
      serverId: "s-1",
      serverName: "Acme MCP",
    };
    await expect(runNode(toolNode(data), input(), deps)).rejects.toThrow(
      /Tool node "tool": tool "search" from connector "Acme MCP" could not be loaded\. It may have been removed or disabled\./,
    );
  });
});
