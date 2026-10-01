"use client";

import { useCallback, useState } from "react";
import {
  useChatBase,
  UseChatOptions,
  FileAttachment,
  createUserMessage,
  createAssistantMessage,
} from "./use-chat-base";
import { useChatSettings, useMachineStateStore } from "@/lib/stores";
import { Message } from "@/lib/types";
import { isAutoRouterModel } from "@/lib/langchain/model-config";
import { parseSseChunk } from "@/lib/utils/sse";

const STREAM_FLUSH_INTERVAL_MS = 30;

/**
 * Hook for normal chat (without multi-agent team workflows)
 * This is a simplified version that handles basic chat streaming.
 */
export function useChat(options: UseChatOptions = {}) {
  const { agentId, systemPrompt } = options;
  const memoryEnabled = useChatSettings((state) => state.memoryEnabled);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null,
  );

  const base = useChatBase(options);
  const {
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
  } = base;

  const handleVersionChange = useCallback(
    (messageId: string, newIndex: number) => {
      const messagesToSave: { id: string; index: number }[] = [];

      setMessages((prev) => {
        const newMessages = [...prev];
        const msgIndex = newMessages.findIndex((m) => m.id === messageId);
        if (msgIndex === -1) return prev;

        const message = newMessages[msgIndex];
        if (
          !message.versions ||
          newIndex < 0 ||
          newIndex >= message.versions.length
        ) {
          return prev;
        }

        // Update the target message
        newMessages[msgIndex] = {
          ...message,
          activeVersionIndex: newIndex,
          content: message.versions[newIndex].content,
          model: message.versions[newIndex].model,
          toolCalls: message.versions[newIndex].toolCalls,
          documents: message.versions[newIndex].documents,
          images: message.versions[newIndex].images,
          tokens: message.versions[newIndex].tokens,
          citations: message.versions[newIndex].citations,
          researchReport: message.versions[newIndex].researchReport,
        };
        messagesToSave.push({ id: message.id, index: newIndex });

        // Handle pairing logic
        const version = message.versions[newIndex];

        // 1. User message switched -> Update following assistant message
        if (message.role === "user" && version.pairedAssistantVersionId) {
          const assistantMsgIndex = newMessages.findIndex(
            (m, i) =>
              i > msgIndex &&
              m.role === "assistant" &&
              m.versions?.some(
                (v) => v.versionId === version.pairedAssistantVersionId,
              ),
          );
          if (assistantMsgIndex !== -1) {
            const assistantMsg = newMessages[assistantMsgIndex];
            const pairedIdx = assistantMsg.versions!.findIndex(
              (v) => v.versionId === version.pairedAssistantVersionId,
            );
            if (pairedIdx !== assistantMsg.activeVersionIndex) {
              newMessages[assistantMsgIndex] = {
                ...assistantMsg,
                activeVersionIndex: pairedIdx,
                content: assistantMsg.versions![pairedIdx].content,
                model: assistantMsg.versions![pairedIdx].model,
                toolCalls: assistantMsg.versions![pairedIdx].toolCalls,
                documents: assistantMsg.versions![pairedIdx].documents,
                images: assistantMsg.versions![pairedIdx].images,
                tokens: assistantMsg.versions![pairedIdx].tokens,
                citations: assistantMsg.versions![pairedIdx].citations,
                researchReport:
                  assistantMsg.versions![pairedIdx].researchReport,
              };
              messagesToSave.push({ id: assistantMsg.id, index: pairedIdx });
            }
          }
        }

        // 2. Assistant message switched -> Ensure preceding user message matches
        if (message.role === "assistant" && version.pairedUserVersionId) {
          const userMsgIndex = newMessages.findIndex(
            (m, i) =>
              i < msgIndex &&
              m.role === "user" &&
              m.versions?.some(
                (v) => v.versionId === version.pairedUserVersionId,
              ),
          );
          if (userMsgIndex !== -1) {
            const userMsg = newMessages[userMsgIndex];
            const pairedIdx = userMsg.versions!.findIndex(
              (v) => v.versionId === version.pairedUserVersionId,
            );
            if (pairedIdx !== userMsg.activeVersionIndex) {
              newMessages[userMsgIndex] = {
                ...userMsg,
                activeVersionIndex: pairedIdx,
                content: userMsg.versions![pairedIdx].content,
                model: userMsg.versions![pairedIdx].model,
              };
              messagesToSave.push({ id: userMsg.id, index: pairedIdx });
            }
          }
        }

        return newMessages;
      });

      // Fire-and-forget API calls to save the version indexes to the backend
      if (threadId) {
        messagesToSave.forEach(({ id, index }) => {
          fetch("/api/chat/message/version", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId,
              messageId: id,
              activeVersionIndex: index,
            }),
          }).catch((err) =>
            console.error("Failed to save active version index:", err),
          );
        });
      }
    },
    [setMessages, threadId],
  );

  const sendMessage = useCallback(
    async (
      attachments: FileAttachment[] = [],
      forceWebSearch?: boolean,
      overrideMessage?: string,
      regenerateMessageId?: string,
      editMessageId?: string,
      reasoningEffort?: import("@/lib/types").ReasoningEffort,
    ) => {
      const isRegeneration = Boolean(regenerateMessageId);
      const isEdit = Boolean(editMessageId);
      const messageContent = (overrideMessage ?? input).trim();
      if (
        (!messageContent && attachments.length === 0 && !isRegeneration) ||
        isLoading
      )
        return;
      if ((isRegeneration || isEdit) && !threadId) return;

      const modelToUse = selectedModel;
      const endpoint = agentId ? "/api/agent/stream" : "/api/chat/stream";
      let pendingUserMessageId: string | null = null;

      if (!isRegeneration && !isEdit) {
        const userMessage = createUserMessage(
          messageContent,
          threadId || "",
          attachments,
          "",
          "",
        );
        pendingUserMessageId = userMessage.id;
        setMessages((prev) => [...prev, userMessage]);
        if (overrideMessage === undefined) {
          setInput("");
        }
      } else if (isRegeneration) {
        setStreamingMessageId(regenerateMessageId ?? null);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === regenerateMessageId
              ? {
                  ...message,
                  content: "",
                  model: modelToUse,
                  toolCalls: undefined,
                  citations: undefined,
                  researchReport: undefined,
                }
              : message,
          ),
        );
      } else if (isEdit && editMessageId) {
        // Compute nextStreamingMessageId before calling setMessages — React calls
        // functional updaters during the render phase, not synchronously, so any
        // mutation inside the updater closure would not be visible on the next line.
        const editIdx = messages.findIndex((m) => m.id === editMessageId);
        let nextStreamingMessageId: string | null = null;
        let preCreatedAssistantMessage: Message | null = null;

        if (editIdx !== -1) {
          if (
            editIdx + 1 < messages.length &&
            messages[editIdx + 1].role === "assistant"
          ) {
            nextStreamingMessageId = messages[editIdx + 1].id;
          } else {
            preCreatedAssistantMessage = createAssistantMessage(
              threadId || "",
              modelToUse,
            );
            nextStreamingMessageId = preCreatedAssistantMessage.id;
          }
        }

        setMessages((prev) => {
          const nextMessages = [...prev];
          const idx = nextMessages.findIndex((m) => m.id === editMessageId);
          if (idx === -1) return prev;

          nextMessages[idx] = {
            ...nextMessages[idx],
            content: messageContent,
            model: modelToUse,
          };

          if (
            idx + 1 < nextMessages.length &&
            nextMessages[idx + 1].role === "assistant"
          ) {
            nextMessages[idx + 1] = {
              ...nextMessages[idx + 1],
              content: "",
              model: modelToUse,
              toolCalls: undefined,
              citations: undefined,
              researchReport: undefined,
            };
          } else if (preCreatedAssistantMessage) {
            nextMessages.splice(idx + 1, 0, preCreatedAssistantMessage);
          }

          return nextMessages;
        });
        setStreamingMessageId(nextStreamingMessageId);
      }
      setIsLoading(true);
      setError(null);
      useMachineStateStore.getState().setMachineStatus("streaming");
      useMachineStateStore.getState().setLiveTokens(null);
      useMachineStateStore.getState().setLiveRoutedModel(null);
      useMachineStateStore.getState().addAuditLog({
        action: "User prompt submitted",
        detail: messageContent.slice(0, 80),
        type: "user",
      });

      abortControllerRef.current = new AbortController();

      const updateAssistantMessage = (
        updater: (message: Message) => Message,
      ) => {
        setMessages((prev) => {
          const newMessages = [...prev];
          let targetIdx = -1;

          if (isRegeneration && regenerateMessageId) {
            targetIdx = newMessages.findIndex(
              (m) => m.id === regenerateMessageId,
            );
          } else if (isEdit && editMessageId) {
            const editIdx = newMessages.findIndex(
              (m) => m.id === editMessageId,
            );
            if (
              editIdx !== -1 &&
              editIdx + 1 < newMessages.length &&
              newMessages[editIdx + 1].role === "assistant"
            ) {
              targetIdx = editIdx + 1;
            } else if (editIdx !== -1) {
              // Create a new assistant message right after the edited user message
              const assistantMessage = createAssistantMessage(
                threadId || "",
                modelToUse,
              );
              newMessages.splice(editIdx + 1, 0, assistantMessage);
              targetIdx = editIdx + 1;
            }
          } else {
            targetIdx = newMessages.length - 1;
          }

          if (targetIdx < 0 || newMessages[targetIdx].role !== "assistant") {
            return prev;
          }

          newMessages[targetIdx] = updater(newMessages[targetIdx]);
          return newMessages;
        });
      };

      const updatePendingUserMessageId = (savedMessageId: string) => {
        if (!pendingUserMessageId) return;

        setMessages((prev) =>
          prev.map((message) =>
            message.id === pendingUserMessageId
              ? { ...message, id: savedMessageId }
              : message,
          ),
        );
        pendingUserMessageId = savedMessageId;
      };

      try {
        const documents = attachments.filter((a) => a.type === "document");
        const images = attachments.filter((a) => a.type === "image");
        const documentsPayload = documents.length ? documents : undefined;
        const imagesPayload = images.length ? images : undefined;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            message: messageContent,
            model: modelToUse,
            agentId,
            systemPrompt,
            documents: documentsPayload,
            images: imagesPayload,
            forceWebSearch,
            memoryEnabled,
            reasoningEffort:
              reasoningEffort && reasoningEffort !== "off"
                ? reasoningEffort
                : undefined,
            regenerateMessageId: isRegeneration
              ? regenerateMessageId
              : undefined,
            editMessageId: isEdit ? editMessageId : undefined,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to send message");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";
        let newThreadId: string | null = null;
        let lastUpdateTime = 0;
        let sseBuffer = "";

        if (!isRegeneration && !isEdit) {
          const assistantMessage = createAssistantMessage(
            threadId || "",
            modelToUse,
          );
          setStreamingMessageId(assistantMessage.id);
          setMessages((prev) => [...prev, assistantMessage]);
        }

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
                  useMachineStateStore.getState().setActiveThreadId(data.threadId);
                  setMessages((prev) =>
                    prev.map((msg) => ({
                      ...msg,
                      threadId: data.threadId,
                    })),
                  );
                  fetchThreads();
                  invalidateThreads();
                  break;

                case "token":
                  assistantContent += data.content;
                  if (Date.now() - lastUpdateTime > STREAM_FLUSH_INTERVAL_MS) {
                    const estTokens = Math.ceil(assistantContent.length / 4);
                    useMachineStateStore.getState().setLiveTokens({
                      prompt: 0,
                      completion: estTokens,
                      total: estTokens,
                    });
                    updateAssistantMessage((message) => ({
                      ...message,
                      content: assistantContent,
                    }));
                    lastUpdateTime = Date.now();
                  }
                  break;

                case "tool_start":
                  useMachineStateStore.getState().setMachineStatus("executing_tool", data.toolCall.name);
                  useMachineStateStore.getState().addAuditLog({
                    action: `Tool call: ${data.toolCall.name}`,
                    detail: typeof data.toolCall.arguments === "object" ? JSON.stringify(data.toolCall.arguments).slice(0, 100) : "",
                    type: "tool",
                  });
                  updateAssistantMessage((message) => {
                    const toolCalls = message.toolCalls || [];
                    if (toolCalls.some((tc) => tc.id === data.toolCall.id)) {
                      return message;
                    }
                    return {
                      ...message,
                      toolCalls: [...toolCalls, data.toolCall],
                    };
                  });
                  break;

                case "tool_result":
                  useMachineStateStore.getState().setMachineStatus("streaming");
                  useMachineStateStore.getState().addAuditLog({
                    action: `Tool finished: ${data.toolCallId || "tool"}`,
                    detail: typeof data.result === "string" ? data.result.slice(0, 80) : "Result received",
                    type: "tool",
                  });
                  updateAssistantMessage((message) => {
                    if (!message.toolCalls) return message;
                    return {
                      ...message,
                      toolCalls: message.toolCalls.map((tc) =>
                        tc.id === data.toolCallId
                          ? { ...tc, result: data.result }
                          : tc,
                      ),
                    };
                  });
                  break;

                case "token_usage":
                  useMachineStateStore.getState().setLiveTokens({
                    prompt: data.promptTokens,
                    completion: data.completionTokens,
                    total: data.totalTokens,
                  });
                  useMachineStateStore.getState().addAuditLog({
                    action: "Tokens recorded",
                    detail: `${data.totalTokens} tokens (${data.promptTokens} in / ${data.completionTokens} out)`,
                    type: "model",
                  });
                  updateAssistantMessage((message) => ({
                    ...message,
                    tokens: {
                      prompt: data.promptTokens,
                      completion: data.completionTokens,
                    },
                  }));
                  break;

                case "citations":
                  updateAssistantMessage((message) => ({
                    ...message,
                    citations: data.citations,
                  }));
                  break;

                case "model_resolved":
                  if (data.routedModel) {
                    // Every provider names the model it served, so this event is
                    // not evidence of routing. Only the router's own runs get to
                    // claim a route target; the message keeps the resolved name
                    // either way.
                    if (isAutoRouterModel(modelToUse)) {
                      useMachineStateStore.getState().setLiveRoutedModel(data.routedModel);
                      useMachineStateStore.getState().addAuditLog({
                        action: "Model routed",
                        detail: `Routed to ${data.routedModel}`,
                        type: "model",
                      });
                    }
                    updateAssistantMessage((message) => ({
                      ...message,
                      routedModel: data.routedModel,
                    }));
                  }
                  break;

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
                  useMachineStateStore.getState().setMachineStatus("error");
                  useMachineStateStore.getState().addAuditLog({
                    action: "Execution error",
                    detail: data.error,
                    type: "error",
                  });
                  setError(data.error);
                  break;

                case "message_saved":
                  updateAssistantMessage((message) => ({
                    ...message,
                    id: data.messageId,
                  }));
                  break;

                case "user_message_saved":
                  updatePendingUserMessageId(data.messageId);
                  break;

                case "done":
                  useMachineStateStore.getState().setMachineStatus("idle");
                  useMachineStateStore.getState().addAuditLog({
                    action: "Response completed",
                    detail: "Stream completed successfully",
                    type: "system",
                  });
                  updateAssistantMessage((message) => ({
                    ...message,
                    content: assistantContent,
                  }));

                  if (threadId || newThreadId) {
                    await loadMessages(threadId || newThreadId!);
                  }

                  if (newThreadId && !agentId) {
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
          if ((isRegeneration || isEdit) && threadId) {
            await loadMessages(threadId);
          } else {
            setMessages((prev) => prev.slice(0, -1));
          }
        }
      } finally {
        setIsLoading(false);
        setStreamingMessageId(null);
        abortControllerRef.current = null;
        useMachineStateStore.getState().setMachineStatus("idle");
      }
    },
    [
      input,
      messages,
      isLoading,
      threadId,
      selectedModel,
      memoryEnabled,
      router,
      agentId,
      systemPrompt,
      fetchThreads,
      invalidateThreads,
      setMessages,
      setInput,
      setIsLoading,
      setError,
      abortControllerRef,
      setThreadId,
      setThreadTitle,
      updateThreadTitle,
      loadMessages,
    ],
  );

  const handleFeedbackChange = useCallback(
    (
      messageId: string,
      versionId: string,
      feedback: "like" | "dislike" | null,
    ) => {
      setMessages((prev) => {
        const newMessages = [...prev];
        const msgIndex = newMessages.findIndex((m) => m.id === messageId);
        if (msgIndex === -1) return prev;

        const message = newMessages[msgIndex];
        if (!message.versions) return prev;

        const updatedVersions = message.versions.map((v) =>
          v.versionId === versionId
            ? { ...v, feedback: feedback || undefined }
            : v,
        );

        // If the updated version is the active version, also update the root message's feedback
        const isTargetActive =
          message.activeVersionIndex !== undefined &&
          message.versions[message.activeVersionIndex]?.versionId === versionId;

        newMessages[msgIndex] = {
          ...message,
          versions: updatedVersions,
          ...(isTargetActive ? { feedback: feedback || undefined } : {}),
        };

        return newMessages;
      });
    },
    [setMessages],
  );

  return {
    messages,
    setMessages,
    input,
    setInput,
    sendMessage,
    isLoading,
    setIsLoading,
    selectedModel,
    setSelectedModel,
    threadId,
    setThreadId: base.setThreadId,
    threadTitle,
    setThreadTitle: base.setThreadTitle,
    error,
    setError: base.setError,
    stopGeneration,
    resetChat,
    loadMessages,
    handleVersionChange,
    handleFeedbackChange,
    streamingMessageId,
    router: base.router,
    fetchThreads: base.fetchThreads,
    invalidateThreads: base.invalidateThreads,
    updateThreadTitle: base.updateThreadTitle,
  };
}
