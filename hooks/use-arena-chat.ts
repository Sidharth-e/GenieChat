"use client";

import { useCallback, useRef } from "react";
import { Message, ArenaMetadata, ArenaResponse, ChatAttachment } from "@/lib/types";
import { useArenaStore } from "@/lib/stores/arena";
import { parseSseChunk } from "@/lib/utils/sse";
import { createUserMessage, createAssistantMessage } from "./use-chat-base";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";

interface UseArenaChatOptions {
  threadId?: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setThreadId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setThreadTitle: React.Dispatch<React.SetStateAction<string>>;
  fetchThreads: () => void;
  invalidateThreads: () => void;
  updateThreadTitle: (threadId: string, title: string) => void;
  loadMessages: (id: string) => Promise<void>;
  router: ReturnType<typeof import("next/navigation").useRouter>;
}

export function useArenaChat(options: UseArenaChatOptions) {
  const {
    threadId,
    setMessages,
    setIsLoading,
    setError,
    setThreadId,
    setThreadTitle,
    fetchThreads,
    invalidateThreads,
    updateThreadTitle,
    loadMessages,
    router,
  } = options;

  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    selectedModels,
    initArenaStream,
    appendArenaContent,
    finishArenaStream,
    clearArenaStreaming,
    updateArenaStream,
  } = useArenaStore();

  const sendArenaMessage = useCallback(
    async (messageContent: string, attachments: ChatAttachment[] = [], memoryEnabled = true) => {
      const trimmed = messageContent.trim();
      if ((!trimmed && attachments.length === 0) || selectedModels.length < 2) return;

      // Add optimistic user message
      const userMessage = createUserMessage(trimmed, threadId || "", attachments);
      const pendingUserMessageId = userMessage.id;

      // Add placeholder assistant message for arena
      const assistantMessage = createAssistantMessage(
        threadId || "",
        selectedModels[0],
      );
      assistantMessage.arenaMetadata = {
        isArena: true,
        responses: [],
        winnerId: null,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsLoading(true);
      setError(null);
      initArenaStream(selectedModels);

      abortControllerRef.current = new AbortController();

      try {
        const documents = attachments.filter(a => a.type === "document");
        const images = attachments.filter(a => a.type === "image");

        const response = await fetch("/api/arena/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            message: trimmed,
            models: selectedModels,
            memoryEnabled,
            documents: documents.length ? documents : undefined,
            images: images.length ? images : undefined,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to send arena message");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let newThreadId: string | null = null;

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const parsed = parseSseChunk(sseBuffer, chunk);
          sseBuffer = parsed.remainder;

          for (const eventPayload of parsed.events) {
            try {
              const data = JSON.parse(eventPayload);

              switch (data.type) {
                case "thread":
                  newThreadId = data.threadId;
                  setThreadId(data.threadId);
                  setMessages((prev) =>
                    prev.map((msg) => ({
                      ...msg,
                      threadId: data.threadId,
                    })),
                  );
                  fetchThreads();
                  invalidateThreads();
                  break;

                case "user_message_saved":
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === pendingUserMessageId
                        ? { ...msg, id: data.messageId }
                        : msg,
                    ),
                  );
                  break;

                case "arena_token":
                  appendArenaContent(data.modelId, data.content);
                  break;

                case "arena_model_done":
                  finishArenaStream(data.modelId, data.latencyMs);
                  break;

                case "arena_model_error":
                  updateArenaStream(data.modelId, {
                    error: data.error,
                    isStreaming: false,
                  });
                  break;

                case "arena_complete": {
                  // Build the final arena metadata from the stream data
                  const arenaResponses: ArenaResponse[] =
                    data.responses?.map((r: { modelId: string; modelName?: string; provider?: string; latencyMs?: number; tokens?: { prompt: number; completion: number }; error?: string }) => {
                      const storeState =
                        useArenaStore.getState().activeArenaResponses[
                          r.modelId
                        ];
                      const modelConfig = AVAILABLE_MODELS.find(
                        (m) => m.id === r.modelId,
                      );
                      return {
                        modelId: r.modelId,
                        modelName: r.modelName || modelConfig?.name || r.modelId,
                        provider: r.provider || modelConfig?.provider || "unknown",
                        content: storeState?.content || "",
                        latencyMs: r.latencyMs || storeState?.latencyMs || 0,
                        tokens: r.tokens || storeState?.tokens || { prompt: 0, completion: 0 },
                        error: r.error || storeState?.error,
                        finishedAt: new Date().toISOString(),
                      } satisfies ArenaResponse;
                    }) || [];

                  const arenaMetadata: ArenaMetadata = {
                    isArena: true,
                    responses: arenaResponses,
                    winnerId: null,
                  };

                  // Update the assistant message with arena data and saved ID
                  setMessages((prev) => {
                    const newMsgs = [...prev];
                    const assistantIdx = newMsgs.findIndex(
                      (m) => m.id === assistantMessage.id,
                    );
                    if (assistantIdx >= 0) {
                      const firstSuccess =
                        arenaResponses.find((r) => !r.error) ||
                        arenaResponses[0];
                      newMsgs[assistantIdx] = {
                        ...newMsgs[assistantIdx],
                        id: data.messageId,
                        content: firstSuccess?.content || "",
                        model: firstSuccess?.modelId || selectedModels[0],
                        arenaMetadata,
                      };
                    }
                    return newMsgs;
                  });
                  break;
                }

                case "title":
                  setThreadTitle(data.title);
                  if (threadId) {
                    updateThreadTitle(threadId, data.title);
                  } else if (newThreadId) {
                    updateThreadTitle(newThreadId, data.title);
                  }
                  invalidateThreads();
                  break;

                case "error":
                  setError(data.error);
                  break;

                case "done":
                  if (threadId || newThreadId) {
                    await loadMessages(threadId || newThreadId!);
                  }
                  if (newThreadId) {
                    router.push(`/chat/${newThreadId}`);
                  }
                  break;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "AbortError") {
          setError(e.message);
          // Remove the optimistic messages
          setMessages((prev) => prev.slice(0, -2));
        }
      } finally {
        setIsLoading(false);
        clearArenaStreaming();
        abortControllerRef.current = null;
      }
    },
    [
      selectedModels,
      threadId,
      setMessages,
      setIsLoading,
      setError,
      setThreadId,
      setThreadTitle,
      fetchThreads,
      invalidateThreads,
      updateThreadTitle,
      loadMessages,
      router,
      initArenaStream,
      appendArenaContent,
      finishArenaStream,
      clearArenaStreaming,
      updateArenaStream,
    ],
  );

  const voteArenaWinner = useCallback(
    async (messageId: string, winnerId: string | null) => {
      const effectiveThreadId = threadId;
      if (!effectiveThreadId) return;

      try {
        const response = await fetch("/api/arena/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: effectiveThreadId,
            messageId,
            winnerId,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save vote");
        }

        // Update local message state
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId || !msg.arenaMetadata) return msg;

            const updatedMetadata: ArenaMetadata = {
              ...msg.arenaMetadata,
              winnerId,
              votedAt: new Date().toISOString(),
            };

            // Update content to winner's response
            let contentUpdate: Partial<Message> = {};
            if (winnerId) {
              const winnerResponse = updatedMetadata.responses.find(
                (r) => r.modelId === winnerId,
              );
              if (winnerResponse) {
                contentUpdate = {
                  content: winnerResponse.content,
                  model: winnerResponse.modelId,
                };
              }
            }

            return {
              ...msg,
              ...contentUpdate,
              arenaMetadata: updatedMetadata,
            };
          }),
        );
      } catch (e) {
        console.error("Failed to vote:", e);
      }
    },
    [threadId, setMessages],
  );

  const stopArenaGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      clearArenaStreaming();
    }
  }, [setIsLoading, clearArenaStreaming]);

  return {
    sendArenaMessage,
    voteArenaWinner,
    stopArenaGeneration,
  };
}
