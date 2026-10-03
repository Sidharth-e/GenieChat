import type { WorkflowNodeData, NodeKind } from "@/lib/workflow/types";

// User type
export interface User {
  id: string;
  email: string;
  name: string;
  image?: string;
  createdAt: string;
  updatedAt: string;
  preferences: {
    defaultModel: string;
    theme: "light" | "dark" | "system";
  };
}

// Thread type
export type ThreadType = "chat" | "research" | "agent-api";

export interface Thread {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  isBookmarked: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
  imageCount?: number;
  attachmentCount?: number;
  model: string;
  isShared: boolean;
  shareId?: string;
  shareMode?: "public" | "specific";
  sharedWith?: { id: string; displayName: string; email: string }[];
  agentId?: string;
  isMultiAgent?: boolean;
  isSwarm?: boolean;
  swarmAgentIds?: string[];
  threadType?: ThreadType;
}

// Message types
export type MessageRole = "user" | "assistant" | "system";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  tokens?: { prompt: number; completion: number };
  agentId?: string;
  agentName?: string;
  // For ask_* tool calls, embed the sub-agent's message data for proper nested rendering
  subAgentMessage?: {
    content: string;
    toolCalls?: ToolCall[];
    agentId: string;
    agentName: string;
  };
}

export interface DocumentReference {
  id: string;
  fileName: string;
  /** `s3://bucket/key` for the original upload. */
  ref: string;
  /** `s3://bucket/key` for the extracted text. */
  extractedTextRef?: string;
}

export interface ImageReference {
  id: string;
  fileName: string;
  /** `s3://bucket/key`. */
  ref: string;
  mimeType: string; // image/jpeg, image/png, etc.
  base64Data?: string; // Base64 for AI analysis (transient, not stored in DB)
}

export interface MessageVersion {
  versionId: string;
  content: string;
  model?: string;
  routedModel?: string;
  agentId?: string;
  agentName?: string;
  toolCalls?: ToolCall[];
  documents?: DocumentReference[];
  images?: ImageReference[];
  tokens?: {
    prompt: number;
    completion: number;
  };
  citations?: string[];
  researchReport?: {
    id: string;
    title: string;
    reportRef: string;
    createdAt: string;
  };

  // Branching/Editing support within linear arrays
  pairedUserVersionId?: string; // For assistant msgs: which user version prompted this
  pairedAssistantVersionId?: string; // For user msgs: which assistant version is active for this edit

  feedback?: "like" | "dislike";

  createdAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: MessageRole;

  // Active version content (denormalized for fast reads)
  content: string;
  model?: string;
  routedModel?: string;
  toolCalls?: ToolCall[];
  documents?: DocumentReference[];
  images?: ImageReference[];
  tokens?: {
    prompt: number;
    completion: number;
  };
  citations?: string[];
  researchReport?: {
    id: string;
    title: string;
    reportRef: string;
    createdAt: string;
  };

  // Regeneration support
  versions: MessageVersion[]; // all versions including current
  activeVersionIndex: number; // index into versions[]

  agentId?: string;
  agentName?: string;
  feedback?: "like" | "dislike";
  arenaMetadata?: ArenaMetadata;
  createdAt: string;
}

// Deep Research Report type
export interface DeepResearchReport {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  query: string;
  /** `s3://bucket/key` of the Markdown report. */
  reportRef: string;
  createdAt: string;
}

// Prompt type
export interface Prompt {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  content: string;
  variables: string[];
  isFavorite?: boolean;
  isShared: boolean;
  shareId?: string;
  shareMode?: "public" | "specific";
  sharedWith?: { id: string; displayName: string; email: string }[];
  tags: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// Agent Document type (for files uploaded to agents)
export interface AgentDocument {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** `s3://bucket/key`. Stored; carries no authority. */
  ref: string;
  uploadedAt: string;
  status?: "indexed" | "failed" | "pending";
  error?: string;
}

// Chat Attachment type (for files uploaded during chat input)
export interface ChatAttachment {
  id: string;
  fileName: string;
  /** `s3://bucket/key`. Stored; carries no authority. */
  ref: string;
  /**
   * Presigned URL for immediate preview. It *is* transmitted: the client sends
   * whole `ChatAttachment` objects, so this field travels in the request body on
   * every send, and the zod attachment schema strips it on arrival — which is
   * why it is never written to MongoDB. It is also held in the draft store's
   * browser localStorage (`lib/stores/draft-inputs.ts`, zustand `persist`), so
   * it survives a reload, and it expires on its own when the signature does.
   */
  previewUrl?: string;
  mimeType: string;
  fileSize: number;
  type: "document" | "image";
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

// Agent type
export interface Agent {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string;
  description: string;
  active: boolean;
  isFavorite?: boolean;
  systemPrompt?: string;
  tools?: string[];
  modelId?: string;
  temperature?: number;
  topP?: number;
  subAgents?: { id: string; name: string }[];
  skills?: AgentSkill[];
  context?: Document[];
  documents?: AgentDocument[];
  createdAt: string;
  updatedAt: string;
}

// Document type
export interface Document {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  threadId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** `s3://bucket/key`. Stored; carries no authority. */
  ref: string;
  processingType: "rag" | "full";
  status: "pending" | "processing" | "completed" | "failed";
  metadata?: {
    searchIndexName?: string;
    documentId?: string;
    pageCount?: number;
    extractedText?: string;
  };
  createdAt: string;
}

export type ProviderKey = "google" | "ollama" | "openrouter";
// Model configuration
export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderKey;
  model: string;
  description: string;
  maxInputChars: number;
  maxOutput: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportReasoning?: boolean;
}

export type ReasoningEffort = "off" | "low" | "medium" | "high";

// Chat request/response types
export interface ChatRequest {
  threadId?: string;
  message: string;
  model: string;
  agentId?: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  documents?: {
    name: string;
    type: string;
    data: string; // Base64
  }[];
  images?: {
    name: string;
    type: string;
    data: string; // Base64 data URL
  }[];
}

export interface StreamToken {
  type:
    | "token"
    | "tool_call"
    | "tool_start"
    | "tool_result"
    | "error"
    | "done"
    | "thread"
    | "title"
    | "citations"
    | "agent_turn_start"
    | "agent_turn_end";
  content?: string;
  toolCall?: ToolCall;
  toolCallId?: string;
  result?: string;
  threadId?: string;
  title?: string;
  error?: string;
  documents?: DocumentReference[];
  citations?: string[]; // Citation URLs returned by the web_search tool
  agentId?: string;
  agentName?: string;
  parentToolCallId?: string;
}

// MCP Server Configuration types
export type MCPTransportType = "http" | "sse";

export interface MCPServerConfig {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string; // Server label/name
  description?: string;
  transportType: MCPTransportType;

  // For HTTP/SSE transport
  serverUrl?: string;
  headers?: Record<string, string>;

  // Optional settings
  enabled: boolean;
  timeout?: number; // Connection timeout in ms
  requireApproval?: "always" | "never" | "per_tool";

  createdAt: string;
  updatedAt: string;
}

export type ServerActionResponse<T> =
  | { status: "OK"; response: T }
  | { status: "ERROR"; errors: { message: string }[] }
  | { status: "NOT_FOUND"; errors: { message: string }[] };

// Workflow types for agentic workflows
export interface WorkflowStep {
  id: string;
  name: string;
  agentId: string;
  agentName?: string;
  order: number;
  input?: string; // Optional custom input for this step
  position?: { x: number; y: number }; // Canvas coordinates in workflow editor
  status: "pending" | "running" | "completed" | "error";
  result?: string;
  nextSteps?: string[]; // IDs of the next steps to execute after this one
}

export interface WorkflowTrigger {
  type: "manual" | "webhook" | "schedule";
  config?: {
    webhookSecret?: string;
    cronExpression?: string;
    position?: { x: number; y: number };
  };
}

export type WorkflowOutputType = "markdown" | "text" | "json";

export interface WorkflowOutputConfig {
  type: WorkflowOutputType;
}

export interface Workflow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string;
  description?: string;
  trigger?: WorkflowTrigger;
  output?: WorkflowOutputConfig;
  outputPosition?: { x: number; y: number };
  steps: WorkflowStep[];
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecutionStep {
  stepId: string;
  stepName: string;
  agentId?: string;
  agentName?: string;
  status: "pending" | "running" | "completed" | "error";
  startTime?: string;
  endTime?: string;
  duration?: number; // in seconds
  input?: string;
  output?: string;
  error?: string;
  toolCalls?: ToolCall[];
  nextSteps?: string[];
  tokens?: { prompt: number; completion: number };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string; // Workflow name at time of execution or custom run name
  status: "pending" | "running" | "completed" | "error";
  startTime: string;
  endTime?: string;
  duration?: number; // in seconds
  steps: WorkflowExecutionStep[];
  currentStepIndex: number;
  initialInput: string;
  finalOutput?: string;
  error?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecutionStreamEvent {
  type:
    | "workflow_start"
    | "step_start"
    | "step_thinking"
    | "step_token"
    | "tool_call_start"
    | "tool_result"
    | "step_complete"
    | "step_error"
    | "workflow_complete"
    | "workflow_error";
  workflowId?: string;
  stepId?: string;
  stepIndex?: number;
  stepName?: string;
  agentId?: string;
  agentName?: string;
  content?: string;
  result?: string;
  error?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  toolResult?: string;
  duration?: number;
  finalResult?: string;
  tokens?: { prompt: number; completion: number };
}

// Custom Tool type for user-defined tools
export interface CustomToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface CustomTool {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string;
  description: string;
  category?: string;
  code: string; // JavaScript function body as string
  parameters: CustomToolParameter[];
  enabled: boolean;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolSecret {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string;
  value: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type NoteColor =
  | "yellow"
  | "pink"
  | "blue"
  | "green"
  | "purple"
  | "orange"
  | "teal"
  | "gray";

export interface Note {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  content: string;
  color: NoteColor;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ReminderPriority = "low" | "medium" | "high";
export type RecurrencePattern = "daily" | "weekly" | "monthly";

export interface Reminder {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  description?: string;
  dueDate: string;
  time?: string;
  isRecurring: boolean;
  recurrencePattern?: RecurrencePattern;
  isCompleted: boolean;
  priority: ReminderPriority;
  createdAt: string;
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  url: string;
  description?: string;
  icon?: string;
  category?: string;
  createdAt: string;
}

// Arena (Multi-Model Comparison) types
export interface ArenaResponse {
  modelId: string;
  modelName: string;
  provider: string;
  content: string;
  latencyMs: number;
  tokens?: { prompt: number; completion: number };
  feedback?: "like" | "dislike";
  error?: string;
  finishedAt: string;
}

export interface ArenaMetadata {
  isArena: boolean;
  responses: ArenaResponse[];
  winnerId: string | null;
  blindMode?: boolean;
  votedAt?: string;
}

export interface ArenaLeaderboardEntry {
  modelId: string;
  modelName: string;
  provider: string;
  eloRating: number;
  totalVotes: number;
  wins: number;
  losses: number;
  ties: number;
  avgLatencyMs: number;
  categoryRatings?: Record<string, number>;
}

export interface ArenaLeaderboard {
  id: string;
  userId: string;
  entries: ArenaLeaderboardEntry[];
  updatedAt: string;
}

export interface Memory {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When the graph enrichment pass last ran over this memory (spec §5.1's
   * `:Memory` node property). Null means the deterministic layer stored it but
   * the LLM pass has not reached it; the sweep's predicate is exactly this
   * being null. Optional so nothing that builds a Memory by hand breaks.
   */
  enrichedAt?: string | null;
}

export interface QuickAction {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string;
  prompt: string;
  medium: "chat" | "agent";
  agentId?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

// API Key for external agent access
export interface ApiKey {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string; // Human-readable label, e.g. "My Script Key"
  keyHash: string; // SHA-256 hash of the actual key (never store plaintext)
  keyPrefix: string; // First 8 chars for identification, e.g. "sk-ag-ab12..."
  scopes: string[]; // Agent IDs this key can access, or ["*"] for all
  lastUsedAt?: string;
  expiresAt?: string;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Webhook Types ---

export interface WebhookTarget {
  type: "workflow" | "agent";
  id: string;
}

export type WebhookInvocationStatus = "pending" | "running" | "completed" | "failed";

export interface Webhook {
  id: string;
  userId: string;
  name: string;
  description?: string;
  target: WebhookTarget;
  secret: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
}

export interface WebhookInvocation {
  id: string;
  webhookId: string;
  userId: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  sourceIp?: string;
  status: WebhookInvocationStatus;
  executionId?: string;
  error?: string;
  triggeredAt: string;
  completedAt?: string;
  durationMs?: number;
}

// --- Rich Workflow Types (node-based workflows) ---

export interface RichWorkflowNode {
  id: string;
  kind: NodeKind;
  name: string;
  description?: string;
  data: WorkflowNodeData;
  position: { x: number; y: number };
}

export interface RichWorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface RichWorkflow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  name: string;
  description?: string;
  icon?: { value?: string; style?: { backgroundColor?: string } };
  isPublished?: boolean;
  visibility?: "private" | "public";
  nodes: RichWorkflowNode[];
  edges: RichWorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface AiUsage {
  id: string;
  userId: string;
  action: string;
  source: "action" | "dspy";
  model: string;
  tokens?: {
    prompt: number;
    completion: number;
  };
  durationMs?: number;
  response?: string;
  createdAt: string;
}

// Conversation shell contract

/**
 * Options for sending a message. Each chat hook honours the subset it already
 * supported and silently ignores the rest, so callers can use one uniform shape.
 */
export interface SendMessageOptions {
  /** Standard chat only; ignored by the agent and swarm hooks. */
  webSearch?: boolean;
  /** Replaces the composer text for this send. */
  message?: string;
  /** Regenerate the assistant message with this id. */
  regenerateId?: string;
  /** Re-send a user message with this id after an edit. */
  editId?: string;
  /** Standard chat only; ignored by the agent and swarm hooks. */
  reasoningEffort?: ReasoningEffort;
}

export type SendMessage = (
  attachments: ChatAttachment[],
  options?: SendMessageOptions,
) => void | Promise<void>;

// Barcode fence (```barcode)

/** The `format` values a ```` ```barcode ```` fence accepts. */
export type BarcodeFormat =
  | "qrcode"
  | "datamatrix"
  | "code128"
  | "ean13"
  | "upca"
  | "code39";

/** A parsed ```` ```barcode ```` fence body. */
export interface BarcodeConfig {
  format: BarcodeFormat;
  text: string;
  caption?: string;
  /** Integer 1–6. Defaults to 2; clamped when the options are built. */
  scale?: number;
  /** Linear formats only, in millimetres. Defaults to 15; clamped to 5–50. */
  height?: number;
  /** Linear formats only; whether the encoder draws the text bar. */
  includeText?: boolean;
}

/**
 * The slice of bwip-js's render options this fence sets. Declared here rather
 * than imported so the pure module in `lib/barcode.ts` never pulls the encoder
 * in, and so the two cannot drift silently — the renderer hands this object
 * straight to `toSVG`, where it is checked against the vendor's own type.
 */
export interface BarcodeOptions {
  bcid: string;
  text: string;
  scale?: number;
  backgroundcolor?: string;
  height?: number;
  includetext?: boolean;
  textxalign?: "center";
}

/** The subset of chat-hook state the conversation shell renders. */
export interface ConversationState {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  sendMessage: SendMessage;
  isLoading: boolean;
  stopGeneration: () => void;
  streamingMessageId: string | null;
  selectedModel: string;
  threadId?: string | null;
  handleVersionChange?: (messageId: string, newIndex: number) => void;
  handleFeedbackChange?: (
    messageId: string,
    versionId: string,
    feedback: "like" | "dislike" | null,
  ) => void;
}
