"use client";

import { useChat } from "@/hooks/use-chat";
import { createUserMessage } from "@/hooks/use-chat-base";
import { ChatInput } from "./chat-input";
import { MessageItem } from "./message-item";

import { Message, ChatAttachment, ThreadType } from "@/lib/types";
import { cn } from "@/lib/utils";
import * as React from "react";
import {
  usePendingMessageStore,
  useThreadsStore,
  useArenaStore,
} from "@/lib/stores";
import { AI_NAME } from "@/constants/main";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useCanvasStore } from "@/lib/stores/canvas-store";
import { DeepResearchPlanCard } from "./deep-research-plan-card";
import { DeepResearchStatus } from "./deep-research-status";
import { logger } from "@/lib/logger";
import type { DeepResearchDepth } from "@/lib/deep-research";
import type { ReasoningEffort } from "@/lib/types";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { NEW_CHAT_PENDING_KEY } from "@/lib/stores/pending-message";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth";
import { useArenaChat } from "@/hooks/use-arena-chat";
import { ArenaModelSelector } from "./arena-model-selector";
import { useAgents } from "@/hooks/use-agents-queries";

interface ChatConversationProps {
  threadId: string;
  initialMessages?: Message[];
  initialThreadType?: ThreadType;
  initialMessageCount?: number;
}

export function ChatConversation({
  threadId,
  initialMessages,
  initialThreadType = "chat",
  initialMessageCount = 0,
}: ChatConversationProps) {
  const router = useRouter();
  const isNewConversation = threadId === NEW_CHAT_PENDING_KEY;
  const effectiveThreadId = isNewConversation ? undefined : threadId;
  const pendingStoreKey = isNewConversation ? NEW_CHAT_PENDING_KEY : threadId;
  const pendingMessageSent = React.useRef(false);
  const pendingMessageTextRef = React.useRef<string>("");
  const pendingAttachmentsRef = React.useRef<ChatAttachment[]>([]);
  const pendingForceWebSearchRef = React.useRef<boolean>(false);
  const pendingIsResearchRef = React.useRef<boolean>(false);
  const pendingResearchDepthRef = React.useRef<DeepResearchDepth>("medium");
  const pendingIsArenaRef = React.useRef<boolean>(false);
  const pendingArenaModelsRef = React.useRef<string[]>([]);

  // Tools State
  const [isWebSearchEnabled, setIsWebSearchEnabled] = React.useState(false);
  const [threadType, setThreadType] =
    React.useState<ThreadType>(initialThreadType);
  const [isDeepResearchEnabled, setIsDeepResearchEnabled] = React.useState(
    initialThreadType === "research" && initialMessageCount === 0,
  );
  const [deepResearchDepth, setDeepResearchDepth] =
    React.useState<DeepResearchDepth>("medium");
  const [reasoningEffort, setReasoningEffort] =
    React.useState<ReasoningEffort>("off");

  // Research flow state
  const [researchState, setResearchState] = React.useState<
    "IDLE" | "PLANNING" | "REVIEW" | "EXECUTING" | "DONE"
  >("IDLE");
  const [regeneratingMessageId, setRegeneratingMessageId] = React.useState<
    string | null
  >(null);
  const [researchPlan, setResearchPlan] = React.useState<string[]>([]);
  const [researchOutline, setResearchOutline] = React.useState("");
  const [researchQuery, setResearchQuery] = React.useState("");
  const [researchStatusHistory, setResearchStatusHistory] = React.useState<
    string[]
  >([]);
  const [finalReport, setFinalReport] = React.useState("");
  const addThread = useThreadsStore((state) => state.addThread);
  const threadAlreadyInStore = useThreadsStore((state) =>
    isNewConversation
      ? false
      : state.threads.some((thread) => thread.id === threadId),
  );
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
    return !!getPendingMessage(pendingStoreKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only check on mount

  const chatHook = useChat({
    threadId: effectiveThreadId,
    initialMessages,
    skipInitialLoad: hasPendingMessage, // Skip loading if we have a pending message
  });

  const {
    messages,
    setMessages,
    input,
    setInput,
    sendMessage,
    isLoading,
    setIsLoading,
    selectedModel,
    setSelectedModel,
    stopGeneration,
    loadMessages,
    handleVersionChange,
    handleFeedbackChange,
    streamingMessageId,
  } = chatHook;

  const { data: allAgents = [] } = useAgents();
  const agentNames = React.useMemo(() => allAgents.map((a) => a.name), [allAgents]);

  const modelSupportsReasoning =
    AVAILABLE_MODELS.find((m) => m.id === selectedModel)?.supportReasoning ??
    false;

  const isArenaMode = useArenaStore((state) => state.isArenaMode);
  const arenaSelectedModels = useArenaStore((state) => state.selectedModels);

  const { sendArenaMessage, voteArenaWinner, stopArenaGeneration } =
    useArenaChat({
      threadId: chatHook.threadId,
      setMessages,
      setIsLoading,
      setError: chatHook.setError,
      setThreadId: chatHook.setThreadId,
      setThreadTitle: chatHook.setThreadTitle,
      fetchThreads: chatHook.fetchThreads,
      invalidateThreads: chatHook.invalidateThreads,
      updateThreadTitle: chatHook.updateThreadTitle,
      loadMessages,
      router,
    });

  const { scrollRef, bottomRef, scrollToBottom } =
    useAutoScroll<HTMLDivElement>(
      [
        messages.length,
        messages[messages.length - 1]?.content,
        researchState,
        researchStatusHistory.length,
        finalReport.length,
      ],
      { smooth: true },
    );

  // Initial scroll to bottom on mount if we have messages
  React.useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  // Auto-hide research status panel 3s after completion
  React.useEffect(() => {
    if (researchState !== "DONE") return;
    const t = setTimeout(() => setResearchState("IDLE"), 3000);
    return () => clearTimeout(t);
  }, [researchState]);

  // Clear canvas state on thread change
  React.useEffect(() => {
    useCanvasStore.getState().clearCanvas();
  }, [threadId]);

  React.useEffect(() => {
    setThreadType(initialThreadType);
    setIsDeepResearchEnabled(
      initialThreadType === "research" && initialMessageCount === 0,
    );
  }, [initialMessageCount, initialThreadType]);

  const startResearchPlanning = React.useCallback(
    async (messageContent: string, attachments: ChatAttachment[] = []) => {
      const normalizedQuery = messageContent.trim();
      if (!normalizedQuery) return;

      setMessages((prev) => [
        ...prev,
        createUserMessage(
          normalizedQuery,
          effectiveThreadId || "",
          attachments,
          userName,
          userEmail,
        ),
      ]);
      setInput("");
      setThreadType("research");
      setResearchQuery(normalizedQuery);
      setResearchState("PLANNING");
      setResearchPlan([]);
      setResearchOutline("");
      setResearchStatusHistory([]);
      setFinalReport("");
      setIsLoading(true);

      try {
        const res = await fetch("/api/deep-research/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: normalizedQuery,
            depth: deepResearchDepth,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to generate research plan");
        }

        const data = await res.json();
        setResearchPlan(data.queries || [normalizedQuery]);
        setResearchOutline(data.outline || "");
        setResearchState("REVIEW");
      } catch (error) {
        logger.error("Deep research planning error:", error);
        setResearchState("IDLE");
      } finally {
        setIsLoading(false);
      }
    },
    [
      deepResearchDepth,
      effectiveThreadId,
      setInput,
      setIsLoading,
      setMessages,
      userEmail,
      userName,
    ],
  );

  const executeDeepResearch = React.useCallback(
    async (approvedPlan: string[]) => {
      if (!researchQuery.trim()) return;

      setResearchState("EXECUTING");
      setResearchStatusHistory(["Starting deep research..."]);
      setFinalReport("");
      setIsLoading(true);
      let reportSaved = false;
      let completedThreadId: string | null = effectiveThreadId ?? null;

      try {
        const response = await fetch("/api/deep-research/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: effectiveThreadId,
            message: researchQuery,
            plan: approvedPlan,
            outline: researchOutline,
            depth: deepResearchDepth,
          }),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          throw new Error(errorText || "Failed to execute research");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "status") {
                setResearchStatusHistory((prev) => [...prev, data.content]);
              } else if (data.type === "final") {
                setFinalReport(data.content || "");
              } else if (data.type === "error") {
                setResearchStatusHistory((prev) => [
                  ...prev,
                  `Error: ${data.error}`,
                ]);
              } else if (data.type === "report_saved") {
                reportSaved = true;
                completedThreadId = data.threadId || completedThreadId;
                setThreadType("research");
              }
            } catch (e) {
              logger.error("Failed to parse deep research stream event:", e);
            }
          }
        }

        if (reportSaved) {
          if (completedThreadId) {
            if (!effectiveThreadId) {
              router.replace(`/chat/${completedThreadId}`);
            } else {
              await loadMessages(completedThreadId);
            }
          }
        }
      } catch (error) {
        logger.error("Deep research execution error:", error);
        setResearchStatusHistory((prev) => [
          ...prev,
          "An error occurred while executing deep research.",
        ]);
      } finally {
        setIsLoading(false);
        setResearchState("DONE");
        setIsDeepResearchEnabled(false);
      }
    },
    [
      deepResearchDepth,
      loadMessages,
      researchOutline,
      researchQuery,
      router,
      setIsLoading,
      effectiveThreadId,
    ],
  );

  // Check for pending message and send it
  React.useEffect(() => {
    const pendingData = getPendingMessage(pendingStoreKey);

    if (pendingData && !pendingMessageSent.current) {
      pendingMessageSent.current = true;
      pendingMessageTextRef.current = pendingData.message || "";
      pendingAttachmentsRef.current = pendingData.attachments || [];
      pendingForceWebSearchRef.current = pendingData.forceWebSearch || false;
      pendingIsResearchRef.current =
        !!pendingData.isResearch || initialThreadType === "research";
      pendingResearchDepthRef.current =
        pendingData.deepResearchDepth || "medium";

      pendingIsArenaRef.current = !!pendingData.isArena;
      pendingArenaModelsRef.current = pendingData.arenaModels || [];

      setIsWebSearchEnabled(
        pendingIsResearchRef.current
          ? false
          : pendingData.forceWebSearch || false,
      );
      setIsDeepResearchEnabled(pendingIsResearchRef.current);
      setDeepResearchDepth(pendingResearchDepthRef.current);
      if (pendingIsResearchRef.current) {
        setThreadType("research");
      }
      // Activate arena mode if pending from home page
      if (
        pendingIsArenaRef.current &&
        pendingArenaModelsRef.current.length >= 2
      ) {
        useArenaStore.getState().setArenaMode(true);
        useArenaStore
          .getState()
          .setSelectedModels(pendingArenaModelsRef.current);
      }

      if (!isNewConversation && !threadAlreadyInStore) {
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
          threadType: pendingIsResearchRef.current ? "research" : "chat",
        });
      }

      clearPendingMessage(pendingStoreKey);
      setInput(pendingData.message);
    }
  }, [
    addThread,
    clearPendingMessage,
    getPendingMessage,
    initialThreadType,
    isNewConversation,
    pendingStoreKey,
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
      // Use the ref'd message text to avoid race condition where attachments
      // trigger this effect before setInput has updated the input state
      const messageToSend = input || pendingMessageTextRef.current;
      if (pendingIsResearchRef.current) {
        void startResearchPlanning(
          messageToSend,
          pendingAttachmentsRef.current,
        );
        setInput("");
      } else if (
        pendingIsArenaRef.current &&
        pendingArenaModelsRef.current.length >= 2
      ) {
        void sendArenaMessage(messageToSend, pendingAttachmentsRef.current);
        setInput("");
      } else {
        sendMessage(pendingAttachmentsRef.current, {
          webSearch: pendingForceWebSearchRef.current,
          message: messageToSend,
        });
        setInput("");
      }
      pendingMessageTextRef.current = "";
      pendingAttachmentsRef.current = [];
      pendingForceWebSearchRef.current = false;
      pendingIsResearchRef.current = false;
      pendingIsArenaRef.current = false;
      pendingArenaModelsRef.current = [];
    }
  }, [
    input,
    isLoading,
    messages.length,
    sendArenaMessage,
    sendMessage,
    setInput,
    startResearchPlanning,
  ]);

  const handleSubmit = React.useCallback(
    (attachments: ChatAttachment[]) => {
      const messageContent = input.trim();
      if ((!messageContent && attachments.length === 0) || isLoading) return;

      const shouldRunResearch =
        isDeepResearchEnabled ||
        (threadType === "research" && messages.length === 0);

      if (shouldRunResearch) {
        void startResearchPlanning(messageContent, attachments);
        return;
      }

      // Arena mode: send to multiple models
      if (isArenaMode && arenaSelectedModels.length >= 2) {
        void sendArenaMessage(messageContent, attachments);
        setInput("");
        return;
      }

      sendMessage(attachments, {
        webSearch: isWebSearchEnabled,
        reasoningEffort:
          reasoningEffort !== "off" ? reasoningEffort : undefined,
      });
    },
    [
      input,
      isArenaMode,
      arenaSelectedModels.length,
      isDeepResearchEnabled,
      isLoading,
      isWebSearchEnabled,
      reasoningEffort,
      messages.length,
      sendArenaMessage,
      sendMessage,
      setInput,
      startResearchPlanning,
      threadType,
    ],
  );

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
    (!lastMessage || lastMessage.role === "user") &&
    researchState === "IDLE";
  const standaloneLoadingMessage = React.useMemo<Message>(
    () => ({
      id: "__loading-indicator__",
      threadId: effectiveThreadId || "",
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
    [effectiveThreadId, selectedModel, userEmail, userId, userName],
  );

  const handleRegenerate = React.useCallback(
    async (assistantMessageId: string) => {
      if (isLoading || threadType === "research") return;
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
          webSearch: isWebSearchEnabled,
          message: previousPrompt,
          regenerateId: assistantMessageId,
        });
      } finally {
        setRegeneratingMessageId(null);
      }
    },
    [
      isLoading,
      threadType,
      lastAssistantMessageId,
      messages,
      sendMessage,
      isWebSearchEnabled,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Messages Area */}
      <main
        ref={scrollRef}
        className={cn(
          "mr-[2px] flex-1 overflow-y-auto overflow-x-hidden",
          "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-card-border",
        )}
      >
        <div className="mx-auto max-w-3xl">
          {messages.map((message) => (
            <React.Fragment key={message.id}>
              {/* message.toolCalls handling moved to MessageItem */}

              <MessageItem
                message={message}
                name={AI_NAME}
                agentNames={agentNames}
                isStreaming={isLoading && message.id === streamingMessageId}
                onRegenerate={handleRegenerate}
                canRegenerate={
                  message.role === "assistant" &&
                  message.id === lastAssistantMessageId &&
                  threadType !== "research"
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
                          webSearch: isWebSearchEnabled,
                          message: newContent,
                          editId: messageId,
                        })
                    : undefined
                }
                onVersionChange={handleVersionChange}
                onFeedbackChange={handleFeedbackChange}
                onArenaVote={
                  message.arenaMetadata?.isArena ? voteArenaWinner : undefined
                }
              />
            </React.Fragment>
          ))}

          {/* Waiting Animation - shows when loading and no assistant response yet */}
          {shouldShowStandaloneLoadingIndicator && (
            <MessageItem
              message={standaloneLoadingMessage}
              name={AI_NAME}
              agentNames={agentNames}
              isStreaming
            />
          )}

          {researchState === "PLANNING" && (
            <div className="mt-6 w-full px-3 sm:px-4">
              <div className="flex items-center gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
                <div className="relative flex items-center justify-center h-6 w-6 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Generating research plan
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Analyzing your query and drafting search strategy...
                  </p>
                </div>
              </div>
            </div>
          )}

          {researchState === "REVIEW" && (
            <div className="px-3 sm:px-4">
              <DeepResearchPlanCard
                initialQueries={researchPlan}
                onStartResearch={executeDeepResearch}
                onCancel={() => setResearchState("IDLE")}
              />
            </div>
          )}

          {(researchState === "EXECUTING" || researchState === "DONE") && (
            <div className="mt-6 px-3 sm:px-4">
              <DeepResearchStatus
                statusHistory={researchStatusHistory}
                isComplete={researchState === "DONE"}
              />
            </div>
          )}
        </div>
        <div ref={bottomRef} className="h-4" />
      </main>

      {/* Input Area */}
      <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 sm:pt-3">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onStop={isArenaMode ? stopArenaGeneration : stopGeneration}
            isLoading={isLoading}
            placeholder={`Message ${AI_NAME}`}
            contextKey={`thread-${threadId}`}
            model={{
              selectedModel,
              onModelChange: setSelectedModel,
              showModelSelector: !isArenaMode,
              arenaSelector: <ArenaModelSelector disabled={isLoading} />,
            }}
            webSearch={{
              enabled: isWebSearchEnabled,
              onChange: setIsWebSearchEnabled,
            }}
            deepResearch={{
              enabled: isDeepResearchEnabled,
              onChange: setIsDeepResearchEnabled,
              depth: deepResearchDepth,
              onDepthChange: setDeepResearchDepth,
            }}
            {...(modelSupportsReasoning
              ? {
                  reasoning: {
                    effort: reasoningEffort,
                    onChange: setReasoningEffort,
                  },
                }
              : {})}
          />
          {/* <p className="mt-3 text-center text-xs text-tertiary/50">
            {AI_NAME} can make mistakes. Check important info.
          </p> */}
        </div>
      </div>
    </div>
  );
}
