import { describe, it, expect } from "vitest";
import { validateWorkflowSteps } from "@/lib/workflow/validation";

function step(
  id: string,
  name: string,
  agentId: string,
  nextSteps: string[] = [],
) {
  return { id, name, agentId, nextSteps };
}

describe("validateWorkflowSteps", () => {
  it("returns invalid for an empty array", () => {
    const result = validateWorkflowSteps([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one step is required.");
  });

  it("returns valid for a single complete step", () => {
    const result = validateWorkflowSteps([step("s1", "Step 1", "agent1")]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error for a step missing a name", () => {
    const result = validateWorkflowSteps([{ id: "s1", agentId: "agent1", nextSteps: [] }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing a name"))).toBe(true);
  });

  it("returns error for a step missing agentId", () => {
    const result = validateWorkflowSteps([{ id: "s1", name: "Step 1", nextSteps: [] }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must select an agent"))).toBe(true);
  });

  it("returns error for duplicate step IDs", () => {
    const result = validateWorkflowSteps([
      step("s1", "Step 1", "agent1"),
      step("s1", "Step 2", "agent2"),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate step id"))).toBe(true);
  });

  it("returns error for a nextStep pointing to a non-existent step", () => {
    const result = validateWorkflowSteps([step("s1", "Step 1", "agent1", ["s999"])]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing next step"))).toBe(true);
  });

  it("returns error for a step that points to itself in nextSteps", () => {
    const result = validateWorkflowSteps([step("s1", "Step 1", "agent1", ["s1"])]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cannot point to itself"))).toBe(true);
  });

  it("returns error for a cycle in the step graph", () => {
    const result = validateWorkflowSteps([
      step("s1", "Step 1", "agent1", ["s2"]),
      step("s2", "Step 2", "agent2", ["s1"]),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
  });

  it("returns valid for a linear multi-step DAG", () => {
    const result = validateWorkflowSteps([
      step("s1", "Ingest", "agent1", ["s2"]),
      step("s2", "Process", "agent2", ["s3"]),
      step("s3", "Output", "agent3"),
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid for a DAG with a merge node", () => {
    const result = validateWorkflowSteps([
      step("s1", "Branch A", "agent1", ["s3"]),
      step("s2", "Branch B", "agent2", ["s3"]),
      step("s3", "Merge", "agent3"),
    ]);
    expect(result.valid).toBe(true);
  });

  it("deduplicates identical error messages", () => {
    const result = validateWorkflowSteps([
      step("s1", "Step 1", "agent1", ["s999", "s999"]),
    ]);
    const missingErrors = result.errors.filter((e) => e.includes("missing next step"));
    expect(missingErrors).toHaveLength(1);
  });
});
