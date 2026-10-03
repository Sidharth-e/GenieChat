import { describe, expect, it } from "vitest";
import {
  TARGET_INPUT_SCHEMAS,
  agentInputSchema,
  targetInputSchema,
  workflowInputSchema,
} from "@/lib/schedules/input-schemas";

describe("target input schemas", () => {
  it("requires a message for both registered kinds", () => {
    for (const schema of [workflowInputSchema, agentInputSchema]) {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ message: "hi" }).success).toBe(true);
    }
  });

  // Review Focus 5's contract: `buildInputForm` renders a labelled field from
  // `.describe()`, and a schema whose only field has no description would render
  // an unlabelled box. This is the assertion that keeps the label there.
  it("describes the message field so the editor can label it", () => {
    expect(workflowInputSchema.shape.message.description).toBeTruthy();
    expect(agentInputSchema.shape.message.description).toBeTruthy();
  });

  it("looks a schema up by target type and returns null for one with no executor", () => {
    expect(targetInputSchema("agent")).toBe(agentInputSchema);
    expect(targetInputSchema("workflow")).toBe(workflowInputSchema);
    expect(targetInputSchema("tool")).toBeNull();
  });

  it("indexes exactly the kinds that have a schema", () => {
    expect(Object.keys(TARGET_INPUT_SCHEMAS).sort()).toEqual(["agent", "workflow"]);
  });
});
