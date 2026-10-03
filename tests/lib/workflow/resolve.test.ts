import { describe, expect, it } from "vitest";
import {
  allConditionBranches,
  evaluateConditionBranch,
  resolveTipTapContent,
  resolveValue,
  routeCondition,
} from "@/lib/workflow/resolve";
import type { ConditionBranch, ConditionBranches } from "@/lib/workflow/condition";
import type { TipTapMentionJsonContent } from "@/lib/workflow/types";

const mentionDoc = (id: string): TipTapMentionJsonContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Summary: " },
        { type: "mention", attrs: { id, label: id } },
      ],
    },
  ],
});

const branch = (over: Partial<ConditionBranch>): ConditionBranch => ({
  id: "b",
  type: "if",
  conditions: [],
  logicalOperator: "AND",
  ...over,
});

describe("resolveValue", () => {
  it("returns the string unchanged", () => {
    expect(resolveValue("https://example.com", {})).toBe("https://example.com");
  });

  it("returns empty for undefined", () => {
    expect(resolveValue(undefined, {})).toBe("");
  });

  it("walks a source path into the outputs map", () => {
    const outputs = { llm1: { answer: { text: "hello" } } };
    expect(resolveValue({ nodeId: "llm1", path: ["answer", "text"] }, outputs)).toBe(
      "hello",
    );
  });

  it("returns empty when the node never ran", () => {
    expect(resolveValue({ nodeId: "missing", path: [] }, {})).toBe("");
  });

  it("returns empty when the path does not exist", () => {
    expect(resolveValue({ nodeId: "llm1", path: ["nope"] }, { llm1: { a: 1 } })).toBe(
      "",
    );
  });

  it("JSON-encodes a non-string leaf", () => {
    expect(resolveValue({ nodeId: "n1", path: ["rows"] }, { n1: { rows: [1, 2] } })).toBe(
      "[1,2]",
    );
  });
});

describe("resolveTipTapContent", () => {
  it("concatenates text and substituted mentions", () => {
    const outputs = { llm1: { answer: "world" } };
    expect(resolveTipTapContent(mentionDoc("llm1.answer"), outputs)).toBe(
      "Summary: world",
    );
  });

  it("returns empty for undefined content", () => {
    expect(resolveTipTapContent(undefined, {})).toBe("");
  });

  it("substitutes an unresolved mention with an empty string", () => {
    expect(resolveTipTapContent(mentionDoc("gone.answer"), {})).toBe("Summary: ");
  });
});

describe("evaluateConditionBranch", () => {
  it("treats an else branch as always true", () => {
    expect(evaluateConditionBranch(branch({ type: "else", conditions: [] }), {})).toBe(
      true,
    );
  });

  it("is false when a non-else branch has no conditions", () => {
    expect(evaluateConditionBranch(branch({ conditions: [] }), {})).toBe(false);
  });

  it("ANDs the rules", () => {
    const b = branch({
      logicalOperator: "AND",
      conditions: [
        { source: { nodeId: "n", path: [] }, operator: "eq", value: "a" },
        { source: { nodeId: "n", path: [] }, operator: "eq", value: "b" },
      ],
    });
    expect(evaluateConditionBranch(b, { n: "a" })).toBe(false);
  });

  it("ORs the rules", () => {
    const b = branch({
      logicalOperator: "OR",
      conditions: [
        { source: { nodeId: "n", path: [] }, operator: "eq", value: "a" },
        { source: { nodeId: "n", path: [] }, operator: "eq", value: "b" },
      ],
    });
    expect(evaluateConditionBranch(b, { n: "a" })).toBe(true);
  });

  it("compares numbers numerically for gt", () => {
    const b = branch({
      conditions: [
        { source: { nodeId: "n", path: [] }, operator: "gt", value: 9 },
      ],
    });
    expect(evaluateConditionBranch(b, { n: "10" })).toBe(true);
  });

  it("returns false for an unknown operator rather than throwing", () => {
    const b = branch({
      conditions: [
        { source: { nodeId: "n", path: [] }, operator: "wat", value: 1 },
      ],
    });
    expect(evaluateConditionBranch(b, { n: "1" })).toBe(false);
  });
});

describe("allConditionBranches", () => {
  it("lists if, elseIf and else in order", () => {
    const branches: ConditionBranches = {
      if: branch({ id: "if-1", type: "if" }),
      elseIf: [branch({ id: "elif-1", type: "elseIf" })],
      else: branch({ id: "else-1", type: "else" }),
    };
    expect(allConditionBranches(branches).map((b) => b.id)).toEqual([
      "if-1",
      "elif-1",
      "else-1",
    ]);
  });

  it("returns an empty list for undefined", () => {
    expect(allConditionBranches(undefined)).toEqual([]);
  });
});

describe("routeCondition", () => {
  const branches: ConditionBranches = {
    if: branch({
      id: "if-1",
      type: "if",
      conditions: [{ source: { nodeId: "n", path: [] }, operator: "eq", value: "a" }],
    }),
    elseIf: [
      branch({
        id: "elif-1",
        type: "elseIf",
        conditions: [{ source: { nodeId: "n", path: [] }, operator: "eq", value: "b" }],
      }),
    ],
    else: branch({ id: "else-1", type: "else" }),
  };

  it("picks if when it matches", () => {
    expect(routeCondition(branches, { n: "a" })).toEqual({
      branchId: "if-1",
      branchType: "if",
    });
  });

  it("picks the matching elseIf", () => {
    expect(routeCondition(branches, { n: "b" })).toEqual({
      branchId: "elif-1",
      branchType: "elseIf",
    });
  });

  it("falls through to else", () => {
    expect(routeCondition(branches, { n: "z" })).toEqual({
      branchId: "else-1",
      branchType: "else",
    });
  });
});
