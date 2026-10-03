import { Node } from "@xyflow/react";
import type { ConditionBranches } from "./condition";

// Node kind enum — each value represents a distinct workflow node type
export enum NodeKind {
  Input = "input",
  LLM = "llm",
  Condition = "condition",
  Note = "note",
  Tool = "tool",
  Http = "http",
  Template = "template",
  Code = "code",
  Output = "output",
}

// JSON Schema subset for output schemas
export type JsonSchema7 = {
  type?: string;
  properties?: Record<string, JsonSchema7>;
  items?: JsonSchema7 | JsonSchema7[];
  enum?: unknown[];
  required?: string[];
  description?: string;
  default?: unknown;
};

export type ObjectJsonSchema7 = {
  type: "object";
  properties: Record<string, JsonSchema7>;
  required?: string[];
};

// TipTap mention content for rich text with variable references
export type TipTapMentionJsonContent = {
  type: "doc";
  content: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      attrs?: { id: string; label: string };
    }>;
  }>;
};

// Reference to a field from another node's output
export type OutputSchemaSourceKey = {
  nodeId: string;
  path: string[];
};

// Base interface for all node data
export type BaseWorkflowNodeData<T extends { kind: NodeKind }> = {
  id: string;
  name: string;
  description?: string;
  outputSchema: ObjectJsonSchema7;
} & T;

// --- Node Data Types ---

export type InputNodeData = BaseWorkflowNodeData<{ kind: NodeKind.Input }>;

export type OutputNodeData = BaseWorkflowNodeData<{
  kind: NodeKind.Output;
}> & {
  outputData: { key: string; source?: OutputSchemaSourceKey }[];
};

export type NoteNodeData = BaseWorkflowNodeData<{ kind: NodeKind.Note }>;

export type LLMNodeData = BaseWorkflowNodeData<{ kind: NodeKind.LLM }> & {
  model: { provider: string; model: string };
  messages: {
    role: "user" | "assistant" | "system";
    content?: TipTapMentionJsonContent;
  }[];
};

export type ConditionNodeData = BaseWorkflowNodeData<{
  kind: NodeKind.Condition;
}> & {
  branches: ConditionBranches;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
export type HttpValue = string | OutputSchemaSourceKey;

export type HttpNodeData = BaseWorkflowNodeData<{ kind: NodeKind.Http }> & {
  url?: HttpValue;
  method: HttpMethod;
  headers: { key: string; value?: HttpValue }[];
  query: { key: string; value?: HttpValue }[];
  body?: HttpValue;
  timeout?: number;
};

export type TemplateNodeData = BaseWorkflowNodeData<{
  kind: NodeKind.Template;
}> & {
  template: { type: "tiptap"; tiptap: TipTapMentionJsonContent };
};

export type CodeNodeData = BaseWorkflowNodeData<{ kind: NodeKind.Code }> & {
  /** The script body. Empty means the node is not configured yet. */
  code: string;
  language: "python" | "bash";
};

type MCPTool = { type: "mcp-tool"; serverId: string; serverName: string };
type AppTool = { type: "app-tool" };

export type WorkflowToolKey = {
  id: string;
  description: string;
  parameterSchema?: ObjectJsonSchema7;
  returnSchema?: JsonSchema7;
} & (MCPTool | AppTool);

export type ToolNodeData = BaseWorkflowNodeData<{ kind: NodeKind.Tool }> & {
  tool?: WorkflowToolKey;
  model: { provider: string; model: string };
  message?: TipTapMentionJsonContent;
};

// Union of all node data types
export type WorkflowNodeData =
  | InputNodeData
  | OutputNodeData
  | LLMNodeData
  | NoteNodeData
  | ToolNodeData
  | ConditionNodeData
  | HttpNodeData
  | TemplateNodeData
  | CodeNodeData;

// Runtime fields during execution
export type NodeRuntimeField = {
  isNew?: boolean;
  status?: "fail" | "running" | "success";
};

// UI representation with runtime info
export type UINode<Kind extends NodeKind = NodeKind> = Node<
  Extract<WorkflowNodeData, { kind: Kind }> & { runtime?: NodeRuntimeField }
>;

// Execution history record
export type NodeRuntimeHistory = {
  id: string;
  nodeId: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  kind: NodeKind;
  error?: string;
  status: "fail" | "running" | "success";
  result?: { input?: unknown; output?: unknown };
};

export type WorkflowStreamEvent =
  | {
      eventType: "NODE_START";
      nodeId?: string;
      nodeExecutionId?: string;
      node?: { name: string };
    }
  | {
      eventType: "NODE_END";
      nodeId: string;
      nodeExecutionId?: string;
      isOk: boolean;
      error?: string;
      output?: unknown;
      input?: unknown;
    }
  | {
      eventType: "WORKFLOW_END";
      isOk?: boolean;
      output?: unknown;
      error?: string;
    };
