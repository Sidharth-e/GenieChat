import { describe, expect, it } from "vitest";
import { GraphRecursionError, UnreachableNodeError } from "@langchain/langgraph";
import { describeError } from "@/lib/workflow/errors";
import { WORKFLOW_RECURSION_LIMIT } from "@/constants/workflow";

const recursionFailure = () =>
  // If this version's constructor takes no argument, `new GraphRecursionError()`
  // is equally fine: none of the assertions depend on the message it is given.
  new GraphRecursionError("Recursion limit of 100 reached");

const unreachableFailure = () =>
  // The library's own text names the offending node id; none of the assertions
  // depend on it, because the translation must not read it either.
  new UnreachableNodeError("Node `orphan` is not reachable.");

describe("describeError", () => {
  it("turns a recursion failure into a message about the step limit", () => {
    const message = describeError(recursionFailure());
    expect(message).toContain("exceeded the step limit");
    expect(message).toContain(String(WORKFLOW_RECURSION_LIMIT));
    expect(message).toContain("loop");
  });

  it("does not leak LangGraph's own wording for that case", () => {
    expect(describeError(recursionFailure())).not.toContain("Recursion limit of");
  });

  it("passes an ordinary Error's message through", () => {
    expect(
      describeError(new Error('MCP server "weather" is not configured')),
    ).toBe('MCP server "weather" is not configured');
  });

  it("stringifies something that is not an Error", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("turns an unreachable node into a message about a disconnected node", () => {
    const message = describeError(unreachableFailure());
    expect(message).toContain("not connected");
    expect(message.toLowerCase()).toContain("remove");
  });

  it("does not leak LangGraph's own wording for that case", () => {
    expect(describeError(unreachableFailure())).not.toContain("is not reachable");
  });
});
