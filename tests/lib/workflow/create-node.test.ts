import { describe, expect, it } from "vitest";
import { createNodeData } from "@/lib/workflow/create-node";
import { NodeKind } from "@/lib/workflow/types";

describe("createNodeData — Code nodes", () => {
  it("declares files in the Code node's output schema", () => {
    // `executeCodeNode` always returns `files`, and the downstream variable
    // picker builds its options from this schema — without the declaration
    // `files` is present at run time and unselectable in the UI.
    const data = createNodeData(NodeKind.Code);
    expect(data.outputSchema.properties).toMatchObject({
      stdout: { type: "string" },
      stderr: { type: "string" },
      exit_code: { type: "number" },
      files: { type: "array", items: { type: "string" } },
    });
  });

  it("returns a node whose kind is Code", () => {
    expect(createNodeData(NodeKind.Code).kind).toBe(NodeKind.Code);
  });
});
