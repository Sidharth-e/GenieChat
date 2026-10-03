import { describe, expect, it } from "vitest";
import { buildWorkflowGraph } from "@/lib/workflow/build-graph";
import type { WorkflowDeps } from "@/lib/workflow/executors";
import { NodeKind } from "@/lib/workflow/types";
import type { ConditionBranches } from "@/lib/workflow/condition";
import type { RichWorkflow, RichWorkflowEdge, RichWorkflowNode } from "@/lib/types";

const deps: WorkflowDeps = {
  getModel: () => {
    throw new Error("getModel should not be called by these node kinds");
  },
  loadTool: async () => {
    throw new Error("loadTool should not be called by these node kinds");
  },
};

const node = (id: string, kind: NodeKind, data: Record<string, unknown> = {}): RichWorkflowNode =>
  ({
    id,
    kind,
    name: id,
    data: { id, name: id, kind, outputSchema: { type: "object", properties: {} }, ...data },
    position: { x: 0, y: 0 },
  }) as RichWorkflowNode;

const edge = (source: string, target: string, sourceHandle?: string): RichWorkflowEdge => ({
  id: `${source}->${target}:${sourceHandle ?? ""}`,
  source,
  target,
  sourceHandle,
});

const workflow = (nodes: RichWorkflowNode[], edges: RichWorkflowEdge[]): RichWorkflow =>
  ({
    id: "wf-1",
    userId: "u-1",
    userName: "tester",
    userEmail: "t@example.com",
    name: "Test",
    nodes,
    edges,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as RichWorkflow;

const textDoc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const templateNode = (id: string, text: string) =>
  node(id, NodeKind.Template, { template: { type: "tiptap", tiptap: textDoc(text) } });

const branches: ConditionBranches = {
  if: {
    id: "if-1",
    type: "if",
    conditions: [{ source: { nodeId: "in", path: ["n"] }, operator: "eq", value: "a" }],
    logicalOperator: "AND",
  },
  else: { id: "else-1", type: "else", conditions: [], logicalOperator: "AND" },
};

const conditionNode = (id: string) =>
  node(id, NodeKind.Condition, { branches });

describe("buildWorkflowGraph — linear", () => {
  it("runs every node and merges their outputs into the final state", async () => {
    const wf = workflow(
      [node("in", NodeKind.Input), templateNode("t", "hello"), node("out", NodeKind.Output, { outputData: [] })],
      [edge("in", "t"), edge("t", "out")],
    );
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: { a: 1 } });
    expect(result.outputs).toEqual({
      in: { a: 1 },
      t: { text: "hello" },
      out: { text: "hello" },
    });
  });
});

describe("buildWorkflowGraph — fan-out", () => {
  it("keeps both branches' outputs (the reducer test)", async () => {
    const wf = workflow(
      [
        node("in", NodeKind.Input),
        templateNode("a", "A"),
        templateNode("b", "B"),
        node("out", NodeKind.Output, { outputData: [] }),
      ],
      [edge("in", "a"), edge("in", "b"), edge("a", "out"), edge("b", "out")],
    );
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: {} });
    expect(result.outputs.a).toEqual({ text: "A" });
    expect(result.outputs.b).toEqual({ text: "B" });
  });
});

describe("buildWorkflowGraph — condition routing", () => {
  it("routes to the wired branch when it matches", async () => {
    const wf = workflow(
      [
        node("in", NodeKind.Input),
        conditionNode("c"),
        templateNode("yes", "yes"),
        templateNode("no", "no"),
      ],
      [edge("in", "c"), edge("c", "yes", "if-1"), edge("c", "no", "else-1")],
    );
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: { n: "a" } });
    expect(result.outputs.yes).toEqual({ text: "yes" });
    expect(result.outputs.no).toBeUndefined();
  });

  it("takes the else handle when the condition does not match", async () => {
    const wf = workflow(
      [
        node("in", NodeKind.Input),
        conditionNode("c"),
        templateNode("yes", "yes"),
        templateNode("no", "no"),
      ],
      [edge("in", "c"), edge("c", "yes", "if-1"), edge("c", "no", "else-1")],
    );
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: { n: "z" } });
    expect(result.outputs.no).toEqual({ text: "no" });
    expect(result.outputs.yes).toBeUndefined();
  });

  it("terminates cleanly when the matching branch is left unwired", async () => {
    // The common case: ELSE is the pass-through and nobody drew an edge from it.
    const wf = workflow(
      [node("in", NodeKind.Input), conditionNode("c"), templateNode("yes", "yes")],
      [edge("in", "c"), edge("c", "yes", "if-1")],
    );
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: { n: "z" } });
    expect(result.outputs.c).toEqual({ branchId: "else-1", branchType: "else" });
    expect(result.outputs.yes).toBeUndefined();
  });

  it("also terminates when the whole node is unwired", async () => {
    const wf = workflow([node("in", NodeKind.Input), conditionNode("c")], [edge("in", "c")]);
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: { n: "a" } });
    expect(result.outputs.c).toEqual({ branchId: "if-1", branchType: "if" });
  });
});

describe("buildWorkflowGraph — hooks and failure", () => {
  it("reports node start and end", async () => {
    const wf = workflow(
      [node("in", NodeKind.Input), templateNode("t", "x")],
      [edge("in", "t")],
    );
    const started: string[] = [];
    const ended: string[] = [];
    await buildWorkflowGraph(wf, deps, {
      onNodeStart: (n) => started.push(n.id),
      onNodeEnd: (n) => ended.push(n.id),
      onNodeError: (n) => {
        throw new Error(`unexpected failure on ${n.id}`);
      },
    })
      .compile()
      .invoke({ query: {} });
    expect(started).toEqual(["in", "t"]);
    expect(ended).toEqual(["in", "t"]);
  });

  it("aborts the run and reports the failing node", async () => {
    // An LLM node with no messages fails without ever reaching a model.
    const llm = node("llm", NodeKind.LLM, {
      model: { provider: "google", model: "test-model" },
      messages: [],
    });
    const wf = workflow([node("in", NodeKind.Input), llm], [edge("in", "llm")]);
    const errors: string[] = [];
    const run = buildWorkflowGraph(wf, deps, { onNodeError: (n) => errors.push(n.id) })
      .compile()
      .invoke({ query: {} });

    await expect(run).rejects.toThrow(/LLM node "llm" has no message content/);
    expect(errors).toEqual(["llm"]);
  });

  it("keeps Note nodes out of the graph", async () => {
    const wf = workflow(
      [node("in", NodeKind.Input), node("note", NodeKind.Note), templateNode("t", "x")],
      [edge("in", "t")],
    );
    const result = await buildWorkflowGraph(wf, deps).compile().invoke({ query: {} });
    expect(result.outputs.note).toBeUndefined();
    expect(result.outputs.t).toEqual({ text: "x" });
  });
});
