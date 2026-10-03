import { describe, expect, it } from "vitest";
import { allNodeValidate, runnableProblem } from "@/lib/workflow/node-validate";
import { NodeKind } from "@/lib/workflow/types";
import type { RichWorkflowEdge, RichWorkflowNode } from "@/lib/types";

type NodeLike = {
  id: string;
  kind: NodeKind;
  data?: Record<string, unknown>;
};

const node = ({ id, kind, data = {} }: NodeLike) =>
  ({
    id,
    kind,
    name: id,
    position: { x: 0, y: 0 },
    data: { id, name: id, kind, outputSchema: { type: "object", properties: {} }, ...data },
  }) as unknown as RichWorkflowNode;

const edge = (source: string, target: string) =>
  ({ id: `${source}->${target}`, source, target }) as unknown as RichWorkflowEdge;

describe("runnableProblem", () => {
  it("accepts a two-node connected workflow with no Output node", () => {
    // Publishing rules are stricter than running rules: a half-built workflow
    // is still runnable.
    const nodes = [node({ id: "in", kind: NodeKind.Input }), node({ id: "t", kind: NodeKind.Template })];
    expect(runnableProblem({ nodes, edges: [edge("in", "t")] })).toBeNull();
  });

  it("rejects a workflow with no steps at all", () => {
    expect(runnableProblem({ nodes: [], edges: [] })).toMatch(/no steps yet/);
  });

  it("rejects a workflow whose only node is a Note", () => {
    const nodes = [node({ id: "n", kind: NodeKind.Note })];
    expect(runnableProblem({ nodes, edges: [] })).toMatch(/no steps yet/);
  });

  it("rejects several nodes that are not connected to each other", () => {
    const nodes = [
      node({ id: "in", kind: NodeKind.Input }),
      node({ id: "t", kind: NodeKind.Template }),
    ];
    expect(runnableProblem({ nodes, edges: [] })).toMatch(/not connected/);
  });

  it("accepts a single Input node", () => {
    const nodes = [node({ id: "in", kind: NodeKind.Input })];
    expect(runnableProblem({ nodes, edges: [] })).toBeNull();
  });
});

describe("allNodeValidate — Code nodes", () => {
  it("requires code", () => {
    const nodes = [
      node({ id: "in", kind: NodeKind.Input }),
      node({ id: "code", kind: NodeKind.Code, data: { code: "" } }),
      node({ id: "out", kind: NodeKind.Output, data: { outputData: [] } }),
    ];
    const edges = [edge("in", "code"), edge("code", "out")];
    expect(allNodeValidate({ nodes, edges })).toMatchObject({
      errorMessage: 'Code node "code" must have code to run',
    });
  });

  it("accepts a Code node with code", () => {
    const nodes = [
      node({ id: "in", kind: NodeKind.Input }),
      node({ id: "code", kind: NodeKind.Code, data: { code: "print(1)" } }),
      node({ id: "out", kind: NodeKind.Output, data: { outputData: [] } }),
    ];
    const edges = [edge("in", "code"), edge("code", "out")];
    expect(allNodeValidate({ nodes, edges })).toBe(true);
  });
});
