"use client";

import { useSwarmChat } from "@/hooks/use-swarm-chat";
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
import { useAgents as useAllAgents } from "@/hooks/use-agents-queries";
import { Network, Zap } from "lucide-react";

interface SwarmChatConversationProps {
  threadId: string;
}

export function SwarmChatConversation({ threadId }: SwarmChatConversationProps) {
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

  // Get swarmAgentIds from pending message (new threads) or thread store (existing threads)
  const threadFromStore = useThreadsStore((state) =>
    state.threads.find((t) => t.id === threadId),
  );
  const swarmAgentIds = React.useMemo(() => {
    const pending = getPendingMessage(threadId);
    if (pending?.swarmAgentIds?.length) return pending.swarmAgentIds;
    if (threadFromStore?.swarmAgentIds?.length) return threadFromStore.swarmAgentIds;
    return [];
  }, [threadId, getPendingMessage, threadFromStore]);

  // Fetch agent details for the roster
  const [agents, setAgents] = React.useState<Agent[]>([]);
  React.useEffect(() => {
    if (swarmAgentIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      swarmAgentIds.map((id) =>
        fetch(`/api/agents/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (!cancelled) {
        setAgents(results.filter((a): a is Agent => a !== null));
      }
    });
    return () => { cancelled = true; };
  }, [swarmAgentIds]);

  const { data: allAgentsList = [] } = useAllAgents();
  const agentNames = React.useMemo(() => allAgentsList.map((a) => a.name), [allAgentsList]);

  const hasPendingMessage = React.useMemo(() => {
    return !!getPendingMessage(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    messages,
    input,
    setInput,
    sendMessage,
    isLoading,
    stopGeneration,
    streamingMessageId,
    activeAgentIds,
    currentRound,
  } = useSwarmChat({
    threadId,
    swarmAgentIds,
    selectedModel,
    skipInitialLoad: hasPendingMessage,
  });

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

  // Consume pending message
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
          model: selectedModel,
          isShared: false,
          isSwarm: true,
          swarmAgentIds,
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
    clearPendingMessage,
    getPendingMessage,
    selectedModel,
    setInput,
    swarmAgentIds,
    threadAlreadyInStore,
    threadId,
    userEmail,
    userId,
    userName,
  ]);

  // Send after input is set from pending
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
      model: selectedModel,
      versions: [],
      activeVersionIndex: 0,
      createdAt: new Date().toISOString(),
    }),
    [selectedModel, threadId, userEmail, userId, userName],
  );

  const activeAgentName = React.useMemo(() => {
    if (activeAgentIds.length === 0) return "Swarm";
    const names = activeAgentIds
      .map((id) => agents.find((a) => a.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(" & ") : "Agent";
  }, [activeAgentIds, agents]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1 flex-col min-w-0 min-h-0">
        {/* Floating status pill — visible only during generation */}
        {isLoading && activeAgentIds.length > 0 && (
          <div className="absolute right-4 top-3 z-20 flex items-center gap-1.5 rounded-full border border-card-border bg-card/90 px-3 py-1.5 shadow-lg backdrop-blur-sm transition-all duration-200 animate-in fade-in slide-in-from-top-2">
            <Zap className="h-3 w-3 text-amber-400 animate-pulse" />
            <span className="text-[11px] font-medium text-text-primary">
              {activeAgentIds
                .map((id) => agents.find((a) => a.id === id)?.name)
                .filter(Boolean)
                .join(" & ") || "Agent"}
            </span>
            {currentRound > 0 && (
              <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
                R{currentRound}
              </span>
            )}
          </div>
        )}

        {/* Messages */}
        <main
          ref={scrollRef}
          className={cn(
            "mr-[2px] flex-1 overflow-y-auto overflow-x-hidden",
            "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-card-border",
          )}
        >
          <div className="mx-auto max-w-3xl">
            {/* Swarm session indicator — inline system message style */}
            {agents.length > 0 && (
              <div className="flex items-center justify-center gap-3 px-4 py-4">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-card-border to-transparent" />
                <div className="flex items-center gap-2">
                  <Network className="h-3.5 w-3.5 text-text-secondary/50" />
                  <span className="text-[11px] text-text-secondary/60">
                    {agents.map((a) => a.name).join(" · ")}
                  </span>
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-card-border to-transparent" />
              </div>
            )}
            {messages.map((message) => {
              const displayName = message.agentName || "Assistant";
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  name={displayName}
                  agentNames={agentNames}
                  isStreaming={isLoading && message.id === streamingMessageId}
                />
              );
            })}

            {shouldShowStandaloneLoadingIndicator && (
              <MessageItem
                message={standaloneLoadingMessage}
                name={activeAgentName}
                agentNames={agentNames}
                isStreaming
              />
            )}
          </div>
          <div ref={bottomRef} className="h-4" />
        </main>

        {/* Input */}
        <div className="px-4 pb-6 pt-4">
          <div className="mx-auto max-w-3xl">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={(attachments) => sendMessage(attachments)}
              onStop={stopGeneration}
              isLoading={isLoading}
              placeholder={
                agents.length > 0
                  ? `Message ${agents.map((a) => `@[${a.name}]`).join(" ")}...`
                  : "Message swarm..."
              }
              contextKey={`thread-${threadId}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
