import type { Message } from "@/lib/types";
import { MAX_MESSAGE_VERSIONS } from "@/constants/config";

/**
 * The id of the newest assistant message, or null when there is none.
 * Scans backwards so a trailing user message does not hide the last reply.
 */
export function lastAssistantMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      return messages[i].id;
    }
  }
  return null;
}

/**
 * Whether a message has as many versions as it may hold.
 *
 * A message with no stored versions renders one synthesized version, so it
 * counts as one. Both the server check and the UI gate read this, which is what
 * keeps them from disagreeing about where the boundary is.
 */
export function hasReachedVersionLimit(versionCount: number): boolean {
  return Math.max(versionCount, 1) >= MAX_MESSAGE_VERSIONS;
}

export interface LoadingMessageInput {
  threadId: string;
  userId: string;
  userName: string;
  userEmail: string;
  model: string;
}

/**
 * The empty assistant message rendered while waiting for the first token.
 * Its id is a sentinel: it is never persisted and never matches a real message.
 */
export function buildLoadingMessage(input: LoadingMessageInput): Message {
  return {
    id: "__loading-indicator__",
    threadId: input.threadId,
    userId: input.userId,
    role: "assistant",
    userName: input.userName,
    userEmail: input.userEmail,
    content: "",
    model: input.model,
    versions: [],
    activeVersionIndex: 0,
    createdAt: new Date().toISOString(),
  };
}

export interface StandaloneLoaderInput {
  isLoading: boolean;
  streamingMessageId: string | null;
  lastMessage: Message | undefined;
}

/**
 * True when generation has started but no assistant bubble is streaming yet,
 * so the caller should render the placeholder itself.
 */
export function shouldShowStandaloneLoader(
  input: StandaloneLoaderInput,
): boolean {
  return (
    input.isLoading &&
    !input.streamingMessageId &&
    (!input.lastMessage || input.lastMessage.role === "user")
  );
}
