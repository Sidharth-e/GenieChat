"use client";

import { ChatInput } from "./chat-input";
import { MessageItem } from "./message-item";
import { Message, Agent, ChatAttachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import * as React from "react";
import {
  useChatSettings,
  usePendingMessageStore,
  useThreadsStore,
} from "@/lib/stores";
import { useAuthStore } from "@/lib/auth";
import { useAgents } from "@/hooks/use-agents-queries";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import type { useAgentChat } from "@/hooks/use-agent-chat";

/**
 * The chat state both agent conversations share. Picked from the agent hook's
 * return so the multi-agent hook has to match it structurally — the view cannot
 * drift from what the hooks actually provide.
 */
export type AgentChatState = Pick<
  ReturnType<typeof useAgentChat>,
  | "messages"
  | "input"
  | "setInput"
  | "sendMessage"
  | "isLoading"
  | "stopGeneration"
  | "handleVersionChange"
  | "handleFeedbackChange"
  | "streamingMessageId"
>;

interface AgentConversationViewProps {
  agent: Agent;
  threadId: string;
  chat: AgentChatState;
  /**
   * Multi-agent differs in exactly two ways: the composer placeholder, and a
   * thread record flagged `isMultiAgent`. The extra layout wrapper is a real
   * difference (a side panel sits beside it), so each variant keeps its own.
   */
  isMultiAgent?: boolean;
}

/**
 * Shared render tree for agent and multi-agent chat. The two used to be
 * near-identical copies, so every `MessageItem`/`ChatInput` prop change had to
 * be made twice. The hooks stay in the callers, because a hook cannot be chosen
 * conditionally.
 */
export function AgentConversationView({
  agent,
  threadId,
  chat,
  isMultiAgent = false,
}: AgentConversationViewProps) {
  const {
    messages,
    input,
    setInput,
    sendMessage,
    isLoading,
    stopGeneration,
    handleVersionChange,
    handleFeedbackChange,
    streamingMessageId,
  } = chat;

  const [regeneratingMessageId, setRegeneratingMessageId] = React.useState<
    string | null
  >(null);
  const pendingMessageSent = React.useRef(false);
  const pendingMessageTextRef = React.useRef<string>("");
  const pendingAttachmentsRef = React.useRef<ChatAttachment[]>([]);
  const addThread = useThreadsStore((state) => state.addThread);
  const threadAlreadyInStore = useThreadsStore((state) =>
    state.threads.some((thread) => thread.id === threadId),
  );
  const { selectedModel } = useChatSettings();
  const userId = useAuthStore((state) => state.user?.id ?? "");
  const userName = useAuthStore((state) => state.user?.name ?? "");
  const userEmail = useAuthStore((state) => state.user?.email ?? "");

  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );
  const clearPendingMessage = usePendingMessageStore(
    (state) => state.clearPendingMessage,
  );

  const { data: allAgents = [] } = useAgents();
  const agentNames = React.useMemo(
    () => allAgents.map((a) => a.name),
    [allAgents],
  );

  const { scrollRef, bottomRef, scrollToBottom } =
    useAutoScroll<HTMLDivElement>(
      [messages.length, messages[messages.length - 1]?.content],
      { smooth: true },
    );

  React.useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  // Pick up a message handed over from the home page and send it.
  React.useEffect(() => {
    const pendingData = getPendingMessage(threadId);

    if (pendingData && !pendingMessageSent.current) {
      pendingMessageSent.current = true;
      pendingMessageTextRef.current = pendingData.message || "";
      pendingAttachmentsRef.current = pendingData.attachments || [];
      if (!threadAlreadyInStore) {
        const now = new Date().toISOString();
        addThread({
          id: threadId,
          userId,
          userName,
          userEmail,
          title: "New Chat",
          isBookmarked: false,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
          messageCount: 0,
          model: agent.modelId || selectedModel,
          isShared: false,
          agentId: agent.id,
          isMultiAgent,
          threadType: "chat",
        });
      }
      setInput(pendingData.message);
      setTimeout(() => {
        clearPendingMessage(threadId);
      }, 1000);
    }
  }, [
    addThread,
    agent.id,
    agent.modelId,
    clearPendingMessage,
    getPendingMessage,
    isMultiAgent,
    selectedModel,
    setInput,
    threadAlreadyInStore,
    threadId,
    userEmail,
    userId,
    userName,
  ]);

  React.useEffect(() => {
    if (
      (input || pendingAttachmentsRef.current.length > 0) &&
      pendingMessageSent.current &&
      !isLoading &&
      messages.length === 0
    ) {
      const messageToSend = input || pendingMessageTextRef.current;
      sendMessage(pendingAttachmentsRef.current, { message: messageToSend });
      setInput("");
      pendingMessageTextRef.current = "";
      pendingAttachmentsRef.current = [];
    }
  }, [input, isLoading, messages.length, sendMessage, setInput]);

  const lastAssistantMessageId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") {
        return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const shouldShowStandaloneLoadingIndicator =
    isLoading &&
    !streamingMessageId &&
    (!lastMessage || lastMessage.role === "user");
  const standaloneLoadingMessage = React.useMemo<Message>(
    () => ({
      id: "__loading-indicator__",
      threadId,
      userId,
      role: "assistant",
      userName,
      userEmail,
      content: "",
      model: agent.modelId || selectedModel,
      versions: [],
      activeVersionIndex: 0,
      createdAt: new Date().toISOString(),
    }),
    [agent.modelId, selectedModel, threadId, userEmail, userId, userName],
  );

  const handleRegenerate = React.useCallback(
    async (assistantMessageId: string) => {
      if (isLoading) return;
      if (assistantMessageId !== lastAssistantMessageId) return;

      const assistantIndex = messages.findIndex(
        (message) => message.id === assistantMessageId,
      );
      if (assistantIndex <= 0) return;

      const previousUserMessage = messages
        .slice(0, assistantIndex)
        .reverse()
        .find((message) => message.role === "user");
      const previousPrompt = previousUserMessage?.content?.trim();
      if (!previousPrompt) return;

      setRegeneratingMessageId(assistantMessageId);
      try {
        await sendMessage([], {
          message: previousPrompt,
          regenerateId: assistantMessageId,
        });
      } finally {
        setRegeneratingMessageId(null);
      }
    },
    [isLoading, lastAssistantMessageId, messages, sendMessage],
  );

  const content = (
    <>
      {/* Messages Area */}
      <main
        ref={scrollRef}
        className={cn(
          "mr-[2px] flex-1 overflow-y-auto overflow-x-hidden",
          "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-card-border",
        )}
      >
        <div className="mx-auto max-w-3xl">
          {messages.map((message) => {
            // Use sub-agent name if available, otherwise use main agent name
            const displayName = message.agentName || agent.name;

            return (
              <MessageItem
                key={message.id}
                message={message}
                name={displayName}
                agentNames={agentNames}
                isStreaming={isLoading && message.id === streamingMessageId}
                onRegenerate={handleRegenerate}
                canRegenerate={
                  message.role === "assistant" &&
                  message.id === lastAssistantMessageId
                }
                isRegenerating={
                  isLoading &&
                  regeneratingMessageId === message.id &&
                  message.role === "assistant"
                }
                onEditSubmit={
                  message.role === "user" && !isLoading
                    ? (messageId, newContent) =>
                        sendMessage([], {
                          message: newContent,
                          editId: messageId,
                        })
                    : undefined
                }
                onVersionChange={handleVersionChange}
                onFeedbackChange={handleFeedbackChange}
              />
            );
          })}

          {/* Waiting Animation - shows when loading and no assistant response yet */}
          {shouldShowStandaloneLoadingIndicator && (
            <MessageItem
              message={standaloneLoadingMessage}
              name={agent.name}
              agentNames={agentNames}
              isStreaming
            />
          )}
        </div>
        <div ref={bottomRef} className="h-4" />
      </main>

      {/* Input Area */}
      <div className="px-4 pb-6 pt-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={(attachments) => sendMessage(attachments)}
            onStop={stopGeneration}
            isLoading={isLoading}
            placeholder={
              isMultiAgent
                ? `Message ${agent.name} and team...`
                : `Message ${agent.name}...`
            }
            contextKey={`thread-${threadId}`}
          />
        </div>
      </div>
    </>
  );

  if (isMultiAgent) {
    return (
      <div className="flex h-full">
        <div className="flex flex-col flex-1 h-full min-w-0">{content}</div>
      </div>
    );
  }

  return <div className="flex h-full flex-col">{content}</div>;
}
