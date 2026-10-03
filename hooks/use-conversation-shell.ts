"use client";

import * as React from "react";
import { toast } from "sonner";
import { usePendingMessageStore, useThreadsStore } from "@/lib/stores";
import { useAuthStore } from "@/lib/auth";
import { useAgents } from "@/hooks/use-agents-queries";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import type { PendingMessageData } from "@/lib/stores/pending-message";
import type {
  ChatAttachment,
  ConversationState,
  Message,
  SendMessageOptions,
  Thread,
} from "@/lib/types";
import type { ConversationHandlers } from "@/components/chat/conversation-shell";
import {
  buildLoadingMessage,
  lastAssistantMessageId as findLastAssistantMessageId,
  shouldShowStandaloneLoader,
} from "@/lib/conversation";

/** Stable identity so the default costs no extra effect runs. */
const NO_EXTRA_SCROLL_DEPENDENCIES: unknown[] = [];

function defaultShouldRegisterThread(threadAlreadyInStore: boolean): boolean {
  return !threadAlreadyInStore;
}

export interface UseConversationShellOptions {
  threadId: string;
  /** `NEW_CHAT_PENDING_KEY` when the thread is not yet persisted. */
  pendingStoreKey?: string;
  chat: ConversationState;
  /** Fields for the optimistic thread record written before the first send. */
  threadDefaults: Partial<Thread> & { model: string };
  /** Effect 1: set mode-specific state from the pending payload. */
  onPendingLatched?: (pending: PendingMessageData) => void;
  /** Effect 2: send the latched message. Called exactly once. */
  dispatchPending: (text: string, attachments: ChatAttachment[]) => void;
  /** Extra gate ANDed with "is the last assistant message". */
  canRegenerate?: (message: Message) => boolean;
  /** Spread into every send the shell issues (regenerate, edit). */
  sendDefaults?: SendMessageOptions;
  /** Default 0. Swarm passes 1000 to preserve its current timing. */
  clearDelayMs?: number;
  /** Extra values that should also re-trigger auto-scroll (chat's research state). */
  extraScrollDependencies?: unknown[];
  /**
   * Whether to write the optimistic thread record. Defaults to "when it is not
   * already in the store"; chat additionally skips it for a not-yet-persisted
   * thread, because the send itself creates the record there.
   */
  shouldRegisterThread?: (threadAlreadyInStore: boolean) => boolean;
}

export interface UseConversationShellResult {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  agentNames: string[];
  lastAssistantMessageId: string | null;
  showStandaloneLoader: boolean;
  loadingMessage: Message;
  regeneratingMessageId: string | null;
  handleRegenerate: (assistantMessageId: string) => Promise<void>;
  handleEditSubmit: (messageId: string, newContent: string) => void;
  handlers: ConversationHandlers;
}

export function useConversationShell(
  options: UseConversationShellOptions,
): UseConversationShellResult {
  const {
    threadId,
    pendingStoreKey = threadId,
    chat,
    threadDefaults,
    onPendingLatched,
    dispatchPending,
    canRegenerate,
    sendDefaults,
    clearDelayMs = 0,
    extraScrollDependencies = NO_EXTRA_SCROLL_DEPENDENCIES,
    shouldRegisterThread = defaultShouldRegisterThread,
  } = options;

  const { messages, input, setInput, sendMessage, isLoading, selectedModel } =
    chat;

  const userId = useAuthStore((state) => state.user?.id ?? "");
  const userName = useAuthStore((state) => state.user?.name ?? "");
  const userEmail = useAuthStore((state) => state.user?.email ?? "");

  const addThread = useThreadsStore((state) => state.addThread);
  const threadAlreadyInStore = useThreadsStore((state) =>
    state.threads.some((thread) => thread.id === threadId),
  );

  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );
  const clearPendingMessage = usePendingMessageStore(
    (state) => state.clearPendingMessage,
  );

  const { data: allAgents = [] } = useAgents();
  const agentNames = React.useMemo(
    () => allAgents.map((agent) => agent.name),
    [allAgents],
  );

  const { scrollRef, bottomRef, scrollToBottom } =
    useAutoScroll<HTMLDivElement>(
      [
        messages.length,
        messages[messages.length - 1]?.content,
        ...extraScrollDependencies,
      ],
      { smooth: true },
    );

  React.useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  const lastAssistantMessageId = React.useMemo(
    () => findLastAssistantMessageId(messages),
    [messages],
  );

  const showStandaloneLoader = shouldShowStandaloneLoader({
    isLoading,
    streamingMessageId: chat.streamingMessageId,
    lastMessage: messages[messages.length - 1],
  });

  const loadingMessage = React.useMemo(
    () =>
      buildLoadingMessage({
        threadId,
        userId,
        userName,
        userEmail,
        model: threadDefaults.model || selectedModel,
      }),
    [threadId, userId, userName, userEmail, threadDefaults.model, selectedModel],
  );

  const [regeneratingMessageId, setRegeneratingMessageId] = React.useState<
    string | null
  >(null);

  const handleRegenerate = React.useCallback(
    async (assistantMessageId: string) => {
      // Every guard below is a no-op the user can observe, so each says why
      // rather than returning silently — a regenerate that does nothing and
      // explains nothing is indistinguishable from a broken button.
      if (isLoading) {
        toast.info("A response is still streaming.");
        return;
      }
      if (assistantMessageId !== lastAssistantMessageId) {
        toast.error("Only the latest reply can be regenerated.");
        return;
      }

      const assistantIndex = messages.findIndex(
        (message) => message.id === assistantMessageId,
      );
      if (assistantIndex <= 0) {
        toast.error("There is no prompt to regenerate a reply from.");
        return;
      }

      const previousUserMessage = messages
        .slice(0, assistantIndex)
        .reverse()
        .find((message) => message.role === "user");
      const previousPrompt = previousUserMessage?.content?.trim();
      if (!previousPrompt) {
        toast.error("There is no prompt to regenerate a reply from.");
        return;
      }

      setRegeneratingMessageId(assistantMessageId);
      try {
        await sendMessage([], {
          ...sendDefaults,
          message: previousPrompt,
          regenerateId: assistantMessageId,
        });
      } finally {
        setRegeneratingMessageId(null);
      }
    },
    [
      isLoading,
      lastAssistantMessageId,
      messages,
      sendDefaults,
      sendMessage,
    ],
  );

  const handleEditSubmit = React.useCallback(
    (messageId: string, newContent: string) => {
      if (isLoading) return;
      void sendMessage([], {
        ...sendDefaults,
        message: newContent,
        editId: messageId,
      });
    },
    [isLoading, sendDefaults, sendMessage],
  );

  // --- The pending-message handoff -----------------------------------------
  // Two effects, deliberately ordered. Effect 1 latches the payload into refs
  // and registers the thread; effect 2 sends, once the input state it set has
  // been committed. Splitting them is what makes the send see the text.
  const pendingMessageSent = React.useRef(false);
  const pendingMessageTextRef = React.useRef<string>("");
  const pendingAttachmentsRef = React.useRef<ChatAttachment[]>([]);

  React.useEffect(() => {
    const pendingData = getPendingMessage(pendingStoreKey);
    if (!pendingData || pendingMessageSent.current) return;

    pendingMessageSent.current = true;
    pendingMessageTextRef.current = pendingData.message || "";
    pendingAttachmentsRef.current = pendingData.attachments || [];

    if (shouldRegisterThread(threadAlreadyInStore)) {
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
        ...threadDefaults,
      });
    }

    onPendingLatched?.(pendingData);
    setInput(pendingData.message);

    if (clearDelayMs > 0) {
      setTimeout(() => clearPendingMessage(pendingStoreKey), clearDelayMs);
    } else {
      clearPendingMessage(pendingStoreKey);
    }
  }, [
    addThread,
    clearDelayMs,
    clearPendingMessage,
    getPendingMessage,
    onPendingLatched,
    pendingStoreKey,
    setInput,
    shouldRegisterThread,
    threadAlreadyInStore,
    threadDefaults,
    threadId,
    userEmail,
    userId,
    userName,
  ]);

  React.useEffect(() => {
    if (!pendingMessageSent.current) return;
    if (isLoading || messages.length > 0) return;
    if (!input && pendingAttachmentsRef.current.length === 0) return;

    const messageToSend = pendingMessageTextRef.current;
    const attachments = pendingAttachmentsRef.current;

    pendingMessageTextRef.current = "";
    pendingAttachmentsRef.current = [];

    dispatchPending(messageToSend, attachments);
    setInput("");
  }, [dispatchPending, input, isLoading, messages.length, setInput]);

  const handlers: ConversationHandlers = React.useMemo(
    () => ({
      onRegenerate: handleRegenerate,
      canRegenerate,
      isRegeneratingId: regeneratingMessageId,
      onEditSubmit: handleEditSubmit,
      onVersionChange: chat.handleVersionChange,
      onFeedbackChange: chat.handleFeedbackChange,
    }),
    [
      canRegenerate,
      chat.handleFeedbackChange,
      chat.handleVersionChange,
      handleEditSubmit,
      handleRegenerate,
      regeneratingMessageId,
    ],
  );

  return {
    scrollRef,
    bottomRef,
    agentNames,
    lastAssistantMessageId,
    showStandaloneLoader,
    loadingMessage,
    regeneratingMessageId,
    handleRegenerate,
    handleEditSubmit,
    handlers,
  };
}
