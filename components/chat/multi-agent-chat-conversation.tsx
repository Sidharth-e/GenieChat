"use client";

import { useMultiAgentChat } from "@/hooks/use-multi-agent-chat";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
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

interface AgentChatConversationProps {
  agent: Agent;
  threadId: string;
  initialMessages?: Message[];
}

export function MultiAgentChatConversation({
  agent,
  threadId,
  initialMessages,
}: AgentChatConversationProps) {
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

  // Get pending message functions from Zustand store
  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );
  const clearPendingMessage = usePendingMessageStore(
    (state) => state.clearPendingMessage,
  );

  // Check for pending message BEFORE calling useChat (only on initial render)
  const hasPendingMessage = React.useMemo(() => {
    return !!getPendingMessage(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only check on mount

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
  } = useMultiAgentChat({
    threadId,
    initialMessages,
    agentId: agent.id,
    systemPrompt: agent.systemPrompt,
    selectedModel: agent.modelId,
    temperature: agent.temperature,
    topP: agent.topP,
    skipInitialLoad: hasPendingMessage,
  });

  const { data: allAgents = [] } = useAgents();
  const agentNames = React.useMemo(() => allAgents.map((a) => a.name), [allAgents]);

  const { scrollRef, bottomRef, scrollToBottom } =
    useAutoScroll<HTMLDivElement>(
      [messages.length, messages[messages.length - 1]?.content],
      { smooth: true },
    );

  // Initial scroll to bottom
  React.useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  // Check for pending message and send it
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
          isMultiAgent: true,
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
    selectedModel,
    setInput,
    threadAlreadyInStore,
    threadId,
    userEmail,
    userId,
    userName,
  ]);

  // Send the message after input is set
  React.useEffect(() => {
    if (
      (input || pendingAttachmentsRef.current.length > 0) &&
      pendingMessageSent.current &&
      !isLoading &&
      messages.length === 0
    ) {
      const messageToSend = input || pendingMessageTextRef.current;
      sendMessage(pendingAttachmentsRef.current, messageToSend);
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
        await sendMessage([], previousPrompt, assistantMessageId);
      } finally {
        setRegeneratingMessageId(null);
      }
    },
    [isLoading, lastAssistantMessageId, messages, sendMessage],
  );

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-1 h-full min-w-0">
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
              const displayName = message.agentName || agent.name;

              // All assistant messages are now from the supervisor
              // Sub-agent content is embedded in the supervisor's ask_* tool calls
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
                          sendMessage([], newContent, undefined, messageId)
                      : undefined
                  }
                  onVersionChange={handleVersionChange}
                  onFeedbackChange={handleFeedbackChange}
                />
              );
            })}

            {/* Waiting Animation */}
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
              placeholder={`Message ${agent.name} and team...`}
              contextKey={`thread-${threadId}`}
            />
            {/* <p className="mt-3 text-center text-xs text-text-secondary">
              Multi-agent collaboration active.
            </p> */}
          </div>
        </div>
      </div>
    </div>
  );
}
