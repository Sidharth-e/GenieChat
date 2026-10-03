"use client";

import { useChat } from "@/hooks/use-chat";
import { createUserMessage } from "@/hooks/use-chat-base";
import { ChatInput } from "./chat-input";
import { ConversationShell } from "./conversation-shell";
import { useConversationShell } from "@/hooks/use-conversation-shell";

import { Message, ChatAttachment, ThreadType } from "@/lib/types";
import * as React from "react";
import { usePendingMessageStore, useArenaStore } from "@/lib/stores";
import { AI_NAME } from "@/constants/main";
import { useCanvasStore } from "@/lib/stores/canvas-store";
import { DeepResearchPlanCard } from "./deep-research-plan-card";
import { DeepResearchStatus } from "./deep-research-status";
import { logger } from "@/lib/logger";
import type { DeepResearchDepth } from "@/lib/deep-research";
import type { ReasoningEffort } from "@/lib/types";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { NEW_CHAT_PENDING_KEY } from "@/lib/stores/pending-message";
import type { PendingMessageData } from "@/lib/stores/pending-message";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth";
import { useArenaChat } from "@/hooks/use-arena-chat";
import { ArenaModelSelector } from "./arena-model-selector";

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

  // Chat's own pending flags. The shell owns the latch; these carry the
  // research / arena routing that only this surface has.
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
  const [researchPlan, setResearchPlan] = React.useState<string[]>([]);
  const [researchOutline, setResearchOutline] = React.useState("");
  const [researchQuery, setResearchQuery] = React.useState("");
  const [researchStatusHistory, setResearchStatusHistory] = React.useState<
    string[]
  >([]);
  const [finalReport, setFinalReport] = React.useState("");
  const userName = useAuthStore((state) => state.user?.name ?? "");
  const userEmail = useAuthStore((state) => state.user?.email ?? "");

  // Get pending message functions from Zustand store
  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
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
  } = chatHook;

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

  // Effect 1 of the pending handoff: latch the routing flags the shell cannot
  // know about, and the research/arena state that goes with them.
  const onPendingLatched = React.useCallback(
    (pending: PendingMessageData) => {
      const isResearch =
        !!pending.isResearch || initialThreadType === "research";

      pendingForceWebSearchRef.current = pending.forceWebSearch || false;
      pendingIsResearchRef.current = isResearch;
      pendingResearchDepthRef.current = pending.deepResearchDepth || "medium";
      pendingIsArenaRef.current = !!pending.isArena;
      pendingArenaModelsRef.current = pending.arenaModels || [];

      setIsWebSearchEnabled(
        isResearch ? false : pending.forceWebSearch || false,
      );
      setIsDeepResearchEnabled(isResearch);
      setDeepResearchDepth(pendingResearchDepthRef.current);
      if (isResearch) {
        setThreadType("research");
      }
      // Activate arena mode if pending from home page
      if (pending.isArena && (pending.arenaModels?.length ?? 0) >= 2) {
        useArenaStore.getState().setArenaMode(true);
        useArenaStore.getState().setSelectedModels(pending.arenaModels!);
      }
    },
    [initialThreadType],
  );

  // Effect 2: route the latched message to research, arena, or a plain send.
  const dispatchPending = React.useCallback(
    (messageToSend: string, attachments: ChatAttachment[]) => {
      if (pendingIsResearchRef.current) {
        void startResearchPlanning(messageToSend, attachments);
      } else if (
        pendingIsArenaRef.current &&
        pendingArenaModelsRef.current.length >= 2
      ) {
        void sendArenaMessage(messageToSend, attachments);
      } else {
        void sendMessage(attachments, {
          webSearch: pendingForceWebSearchRef.current,
          message: messageToSend,
        });
      }

      pendingForceWebSearchRef.current = false;
      pendingIsResearchRef.current = false;
      pendingIsArenaRef.current = false;
      pendingArenaModelsRef.current = [];
    },
    [sendArenaMessage, sendMessage, startResearchPlanning],
  );

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

  // The research panels scroll into view as they update, so the status history
  // and the final report join the auto-scroll dependencies here.
  const extraScrollDependencies = React.useMemo(
    () => [researchState, researchStatusHistory.length, finalReport.length],
    [researchState, researchStatusHistory.length, finalReport.length],
  );

  const shouldRegisterThread = React.useCallback(
    (inStore: boolean) => !isNewConversation && !inStore,
    [isNewConversation],
  );

  // Stable identities: the shell folds both into its `handlers` memo, which
  // would otherwise be invalidated on every keystroke.
  const canRegenerate = React.useCallback(
    () => threadType !== "research",
    [threadType],
  );
  const sendDefaults = React.useMemo(
    () => ({ webSearch: isWebSearchEnabled }),
    [isWebSearchEnabled],
  );
  const threadDefaults = React.useMemo(
    () => ({ model: selectedModel, threadType }),
    [selectedModel, threadType],
  );

  const shell = useConversationShell({
    threadId: effectiveThreadId || "",
    pendingStoreKey,
    chat: chatHook,
    threadDefaults,
    onPendingLatched,
    dispatchPending,
    canRegenerate,
    sendDefaults,
    extraScrollDependencies,
    shouldRegisterThread,
  });

  return (
    <ConversationShell
      messages={messages}
      isLoading={isLoading}
      streamingMessageId={chatHook.streamingMessageId}
      agentNames={shell.agentNames}
      lastAssistantMessageId={shell.lastAssistantMessageId}
      nameForMessage={() => AI_NAME}
      loadingName={AI_NAME}
      showStandaloneLoader={
        shell.showStandaloneLoader && researchState === "IDLE"
      }
      loadingMessage={shell.loadingMessage}
      handlers={{
        ...shell.handlers,
        onArenaVote: voteArenaWinner,
      }}
      error={chatHook.error}
      slotAfterMessages={
        <>
          {researchState === "PLANNING" && (
            <div className="mt-6 w-full px-3 sm:px-4">
              <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                  <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Generating research plan
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
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
        </>
      }
      composer={
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
      }
      scrollRef={shell.scrollRef}
      bottomRef={shell.bottomRef}
    />
  );
}
