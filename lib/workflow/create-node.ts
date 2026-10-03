import {
  NodeKind,
  type WorkflowNodeData,
  type ObjectJsonSchema7,
} from "./types";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";

const defaultOutputSchema: ObjectJsonSchema7 = {
  type: "object",
  properties: {},
  required: [],
};

export const defaultLLMNodeOutputSchema: ObjectJsonSchema7 = {
  type: "object",
  properties: {
    answer: { type: "string" },
  },
  required: ["answer"],
};

export function createNodeData(
  kind: NodeKind,
  name?: string
): WorkflowNodeData {
  const id = crypto.randomUUID();
  const base = {
    id,
    name: name || kind.charAt(0).toUpperCase() + kind.slice(1),
    outputSchema: { ...defaultOutputSchema },
  };

  switch (kind) {
    case NodeKind.Input:
      return { ...base, kind: NodeKind.Input };
    case NodeKind.Output:
      return { ...base, kind: NodeKind.Output, outputData: [] };
    case NodeKind.LLM:
      return {
        ...base,
        kind: NodeKind.LLM,
        model: { provider: "google", model: DEFAULT_MODEL_ID },
        messages: [{ role: "user" }],
        outputSchema: { ...defaultLLMNodeOutputSchema },
      };
    case NodeKind.Condition:
      return {
        ...base,
        kind: NodeKind.Condition,
        branches: {
          if: {
            id: crypto.randomUUID(),
            type: "if",
            conditions: [],
            logicalOperator: "AND",
          },
          else: {
            id: crypto.randomUUID(),
            type: "else",
            conditions: [],
            logicalOperator: "AND",
          },
        },
      };
    case NodeKind.Note:
      return { ...base, kind: NodeKind.Note };
    case NodeKind.Tool:
      return {
        ...base,
        kind: NodeKind.Tool,
        model: { provider: "google", model: DEFAULT_MODEL_ID },
      };
    case NodeKind.Http:
      return {
        ...base,
        kind: NodeKind.Http,
        method: "GET",
        headers: [],
        query: [],
        timeout: 30000,
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "number" },
            data: { type: "string" },
          },
          required: ["status", "data"],
        },
      };
    case NodeKind.Template:
      return {
        ...base,
        kind: NodeKind.Template,
        template: {
          type: "tiptap",
          tiptap: { type: "doc", content: [{ type: "paragraph" }] },
        },
        outputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      };
    case NodeKind.Code:
      return {
        ...base,
        kind: NodeKind.Code,
        code: "",
        language: "python",
        outputSchema: {
          type: "object",
          properties: {
            stdout: { type: "string" },
            stderr: { type: "string" },
            exit_code: { type: "number" },
            files: { type: "array", items: { type: "string" } },
          },
          required: ["stdout"],
        },
      };
    default:
      return { ...base, kind: NodeKind.Note };
  }
}
