"use client";

import { logger } from "@/lib/logger";
import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Message, ChatAttachment } from "@/lib/types";
import {
  usePendingMessageStore,
  useThreadsStore,
  useChatSettings,
  useMachineStateStore,
} from "@/lib/stores";
import { threadKeys } from "./use-threads-queries";
import { generateId } from "@/lib/utils";

// Shared types
/**
 * Options `useChatBase` itself honours. The specialized hooks extend this with
 * the fields only they read, so those cannot be passed to a hook that would
 * silently ignore them.
 */
export interface BaseChatOptions {
  threadId?: string;
  initialMessages?: Message[];
  skipInitialLoad?: boolean;
  /** Pins the model for agent chat; otherwise the stored selection is used. */
  selectedModel?: string;
}

export interface UseChatOptions extends BaseChatOptions {
  agentId?: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
}

// Re-export ChatAttachment as FileAttachment for backward compatibility
export type FileAttachment = ChatAttachment;

export interface UseChatBaseReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  threadId: string | undefined;
  setThreadId: React.Dispatch<React.SetStateAction<string | undefined>>;
  threadTitle: string;
  setThreadTitle: React.Dispatch<React.SetStateAction<string>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  router: ReturnType<typeof useRouter>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  fetchThreads: () => void;
  invalidateThreads: () => void;
  updateThreadTitle: (threadId: string, title: string) => void;
  stopGeneration: () => void;
  resetChat: () => void;
  loadMessages: (id: string) => Promise<void>;
}

/**
 * Base hook with shared state and utilities for both normal and agent chat
 */
export function useChatBase(options: BaseChatOptions = {}): UseChatBaseReturn {
  const {
    threadId: initialThreadId,
    initialMessages = [],
    skipInitialLoad = false,
  } = options;

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { selectedModel: storedModel, setSelectedModel } = useChatSettings();
  // An explicit option pins the model (agent chat); otherwise the user's stored
  // choice wins. Centralising the precedence here is what lets the specialized
  // hooks stop repeating `options.selectedModel || selectedModel`.
  const selectedModel = options.selectedModel ?? storedModel;
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  const [threadTitle, setThreadTitle] = useState("New Chat");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchThreads = useThreadsStore((state) => state.fetchThreads);
  const updateThreadTitle = useThreadsStore((state) => state.updateThreadTitle);

  const invalidateThreads = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
  }, [queryClient]);
  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );

  useEffect(() => {
    useMachineStateStore.getState().setActiveMessages(messages);
  }, [messages]);

  useEffect(() => {
    useMachineStateStore.getState().setActiveThreadId(threadId ?? null);
  }, [threadId]);

  useEffect(() => {
    useMachineStateStore
      .getState()
      .setMachineStatus(isLoading ? "streaming" : "idle");
  }, [isLoading]);

  useEffect(() => {
    return () => {
      useMachineStateStore.getState().setActiveMessages([]);
      useMachineStateStore.getState().setActiveThreadId(null);
      useMachineStateStore.getState().setMachineStatus("idle");
    };
  }, []);

  // Ensure selected model is one of the server-configured models.
  useEffect(() => {
    let cancelled = false;

    const syncSelectedModel = async () => {
      try {
        const res = await fetch("/api/models", { cache: "no-store" });
        if (!res.ok) return;

        const models = (await res.json()) as Array<{ id: string }>;
        if (!Array.isArray(models) || models.length === 0) return;

        const hasSelectedModel = models.some((model) => model.id === storedModel);
        if (!hasSelectedModel && !cancelled) {
          setSelectedModel(models[0].id);
        }
      } catch (e) {
        logger.warn("Failed to sync configured models:", e);
      }
    };

    void syncSelectedModel();

    return () => {
      cancelled = true;
    };
  }, [storedModel, setSelectedModel]);

  // Load messages from API for a given thread
  const loadMessages = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chat/threads/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      logger.error("Failed to load messages:", e);
    }
  }, []);

  // Load messages when threadId changes
  useEffect(() => {
    if (initialThreadId && initialMessages.length === 0 && !skipInitialLoad) {
      const hasPendingMessage = getPendingMessage(initialThreadId);
      if (!hasPendingMessage) {
        let cancelled = false;
        const fetchInitialMessages = async () => {
          try {
            const res = await fetch(`/api/chat/threads/${initialThreadId}`);
            if (!res.ok || cancelled) return;
            const data = (await res.json()) as Message[];
            if (!cancelled) {
              setMessages(data);
            }
          } catch (e) {
            if (!cancelled) {
              logger.error("Failed to load messages:", e);
            }
          }
        };
        void fetchInitialMessages();
        return () => {
          cancelled = true;
        };
      }
    }
  }, [
    initialThreadId,
    initialMessages.length,
    getPendingMessage,
    skipInitialLoad,
  ]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  const resetChat = useCallback(() => {
    setMessages([]);
    setThreadId(undefined);
    setThreadTitle("New Chat");
    setError(null);
    router.push("/chat/new");
  }, [router]);

  return {
    messages,
    setMessages,
    input,
    setInput,
    isLoading,
    setIsLoading,
    selectedModel,
    setSelectedModel,
    threadId,
    setThreadId,
    threadTitle,
    setThreadTitle,
    error,
    setError,
    router,
    abortControllerRef,
    fetchThreads,
    invalidateThreads,
    updateThreadTitle,
    stopGeneration,
    resetChat,
    loadMessages,
  };
}

/**
 * Creates a user message object
 */
export function createUserMessage(
  content: string,
  threadId: string,
  attachments: ChatAttachment[] = [],
  userName: string = "",
  userEmail: string = "",
): Message {
  const documents = attachments.filter((a) => a.type === "document");
  const images = attachments.filter((a) => a.type === "image");
  const now = new Date().toISOString();
  const trimmedContent = content.trim();
  const mappedDocuments = documents.length
    ? documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        ref: d.ref,
      }))
    : undefined;
  const mappedImages = images.length
    ? images.map((i) => ({
        id: i.id,
        fileName: i.fileName,
        ref: i.ref,
        mimeType: i.mimeType,
      }))
    : undefined;

  const initialVersion = {
    versionId: generateId(),
    content: trimmedContent,
    documents: mappedDocuments,
    images: mappedImages,
    createdAt: now,
  };

  return {
    id: generateId(),
    threadId: threadId || "",
    userId: "dev-user",
    userName,
    userEmail,
    role: "user",
    content: trimmedContent,
    createdAt: now,
    documents: mappedDocuments,
    images: mappedImages,
    versions: [initialVersion],
    activeVersionIndex: 0,
  };
}

/**
 * Creates a placeholder assistant message
 */
export function createAssistantMessage(
  threadId: string,
  model: string,
  userName: string = "",
  userEmail: string = "",
): Message {
  const now = new Date().toISOString();

  return {
    id: generateId(),
    threadId: threadId || "",
    userId: "dev-user",
    userName,
    userEmail,
    role: "assistant",
    content: "",
    model: model,
    createdAt: now,
    versions: [
      {
        versionId: generateId(),
        content: "",
        model,
        createdAt: now,
      },
    ],
    activeVersionIndex: 0,
  };
}
