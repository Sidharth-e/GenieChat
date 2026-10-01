"use client";

import * as React from "react";
import { MessageItem } from "./message-item";
import { Message } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Per-message handlers. Every field is optional: a surface that supplies none
 * of them (swarm) renders the same list without the corresponding affordances,
 * because an absent handler is what makes MessageItem omit them.
 */
export interface ConversationHandlers {
  onRegenerate?: (assistantMessageId: string) => void | Promise<void>;
  /** Extra gate ANDed with "is the last assistant message". */
  canRegenerate?: (message: Message) => boolean;
  isRegeneratingId?: string | null;
  onEditSubmit?: (
    messageId: string,
    newContent: string,
  ) => void | Promise<void>;
  onVersionChange?: (messageId: string, newIndex: number) => void;
  onFeedbackChange?: (
    messageId: string,
    versionId: string,
    feedback: "like" | "dislike" | null,
  ) => void;
  onArenaVote?: (messageId: string, winnerId: string | null) => void;
}

interface ConversationShellProps {
  messages: Message[];
  isLoading: boolean;
  streamingMessageId: string | null;
  agentNames: string[];
  lastAssistantMessageId: string | null;

  /** How a message's author is labelled. */
  nameForMessage: (message: Message) => string;
  /** Label for the standalone loading indicator. */
  loadingName: string;
  /** Whether to render the standalone loading indicator. */
  showStandaloneLoader: boolean;
  loadingMessage: Message;

  handlers?: ConversationHandlers;

  /** Rendered inside the max-w-3xl column, above / below the message list. */
  slotBeforeMessages?: React.ReactNode;
  slotAfterMessages?: React.ReactNode;
  /** Absolutely-positioned content over the scroll area (swarm status pill). */
  overlay?: React.ReactNode;

  /** The configured <ChatInput /> for this surface. */
  composer: React.ReactNode;
  /** `sidePanel` adds the multi-agent column wrapper; `plain` is a flex column. */
  layout?: "plain" | "sidePanel";

  scrollRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * The chat render tree shared by all four surfaces: scroll area, message list,
 * loading indicator and composer block. What differs between surfaces is passed
 * in — naming, slots, overlay, layout and handlers — so the list and composer
 * markup exist exactly once.
 */
export function ConversationShell({
  messages,
  isLoading,
  streamingMessageId,
  agentNames,
  lastAssistantMessageId,
  nameForMessage,
  loadingName,
  showStandaloneLoader,
  loadingMessage,
  handlers = {},
  slotBeforeMessages,
  slotAfterMessages,
  overlay,
  composer,
  layout = "plain",
  scrollRef,
  bottomRef,
}: ConversationShellProps) {
  const content = (
    <>
      <main
        ref={scrollRef}
        className={cn(
          "mr-[2px] flex-1 overflow-y-auto overflow-x-hidden",
          "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-card-border",
        )}
      >
        <div className="mx-auto max-w-3xl">
          {slotBeforeMessages}

          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              name={nameForMessage(message)}
              agentNames={agentNames}
              isStreaming={isLoading && message.id === streamingMessageId}
              onRegenerate={handlers.onRegenerate}
              canRegenerate={
                message.role === "assistant" &&
                message.id === lastAssistantMessageId &&
                (handlers.canRegenerate?.(message) ?? true)
              }
              isRegenerating={
                isLoading &&
                handlers.isRegeneratingId === message.id &&
                message.role === "assistant"
              }
              onEditSubmit={
                message.role === "user" && !isLoading
                  ? handlers.onEditSubmit
                  : undefined
              }
              onVersionChange={handlers.onVersionChange}
              onFeedbackChange={handlers.onFeedbackChange}
              onArenaVote={
                message.arenaMetadata?.isArena
                  ? handlers.onArenaVote
                  : undefined
              }
            />
          ))}

          {showStandaloneLoader && (
            <MessageItem
              message={loadingMessage}
              name={loadingName}
              agentNames={agentNames}
              isStreaming
            />
          )}

          {slotAfterMessages}
        </div>
        <div ref={bottomRef} className="h-4" />
      </main>

      <div className="px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3">
        <div className="mx-auto max-w-3xl">{composer}</div>
      </div>
    </>
  );

  if (layout === "sidePanel") {
    return (
      <div className="flex h-full">
        <div className="relative flex h-full min-w-0 flex-1 flex-col">
          {overlay}
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {overlay}
      {content}
    </div>
  );
}
