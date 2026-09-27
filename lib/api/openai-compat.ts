import { Message } from "@/lib/types";
import { generateId } from "@/lib/utils";

// ---------------------------------------------------------------------------
// OpenAI Chat Completions API types
// ---------------------------------------------------------------------------

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model: string; // Will be the Agent ID
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface OpenAIChatChoice {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | null;
  }[];
}

// ---------------------------------------------------------------------------
// OpenAI Responses API types
// ---------------------------------------------------------------------------

export interface ResponsesApiInputMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ResponsesApiRequest {
  model: string;
  input: string | ResponsesApiInputMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
}

export interface ResponsesApiResponse {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  output: {
    type: "message";
    role: "assistant";
    content: { type: "output_text"; text: string }[];
  }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Converter helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal internal Message object from the given fields.
 */
function makeInternalMessage(
  role: "user" | "assistant" | "system",
  content: string,
  userId: string,
): Message {
  return {
    id: generateId(),
    threadId: "",
    userId,
    userName: "api",
    userEmail: "",
    role,
    content,
    versions: [],
    activeVersionIndex: 0,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Converter functions
// ---------------------------------------------------------------------------

/**
 * Convert OpenAI chat messages to internal Message format.
 * System messages are extracted separately as systemPrompt.
 */
export function openaiMessagesToInternal(
  messages: OpenAIChatMessage[],
  userId: string,
): { systemPrompt: string; internalMessages: Message[] } {
  let systemPrompt = "";
  const internalMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (systemPrompt.length > 0) {
        systemPrompt += "\n";
      }
      systemPrompt += msg.content;
    } else {
      internalMessages.push(makeInternalMessage(msg.role, msg.content, userId));
    }
  }

  return { systemPrompt, internalMessages };
}

/**
 * Convert Responses API input to internal Message format.
 * If input is a string, treat as single user message.
 */
export function responsesInputToInternal(
  input: string | ResponsesApiInputMessage[],
  userId: string,
): { systemPrompt: string; internalMessages: Message[] } {
  if (typeof input === "string") {
    return {
      systemPrompt: "",
      internalMessages: [makeInternalMessage("user", input, userId)],
    };
  }

  // Array of messages — map to OpenAIChatMessage and delegate
  const mapped: OpenAIChatMessage[] = input.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return openaiMessagesToInternal(mapped, userId);
}

/**
 * Build a non-streaming Chat Completions response.
 */
export function buildChatCompletionResponse(
  content: string,
  model: string,
  responseId: string,
): OpenAIChatResponse {
  return {
    id: responseId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

/**
 * Build a single SSE chunk string for streaming Chat Completions.
 * When finishReason is "stop", delta should be empty {}.
 * Returns the string `data: {...}\n\n`
 */
export function buildStreamChunk(
  content: string,
  model: string,
  responseId: string,
  finishReason: "stop" | null = null,
): string {
  const chunk: OpenAIStreamChunk = {
    id: responseId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: finishReason === "stop" ? {} : { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Build a Responses API non-streaming response.
 */
export function buildResponsesApiResponse(
  content: string,
  model: string,
  responseId: string,
): ResponsesApiResponse {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: content }],
      },
    ],
  };
}
