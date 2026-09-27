"use client";

import { useCallback, useState } from "react";
import { Message, ToolCall } from "@/lib/types";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";
import {
    useChatBase,
    UseChatOptions,
    FileAttachment,
    createUserMessage,
    createAssistantMessage
} from "./use-chat-base";
import { parseSseChunk } from "@/lib/utils/sse";

function upsertToolCall(toolCalls: ToolCall[] | undefined, nextToolCall: ToolCall) {
    const existingToolCalls = toolCalls || [];
    if (existingToolCalls.some((toolCall) => toolCall.id === nextToolCall.id)) {
        return existingToolCalls;
    }

    return [...existingToolCalls, nextToolCall];
}

/**
 * Hook for agent chat functionality.
 */
export function useMultiAgentChat(options: UseChatOptions ) {
    const { agentId, systemPrompt, temperature, topP } = options;
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

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
        abortControllerRef,
        fetchThreads,
        invalidateThreads,
        updateThreadTitle,
        stopGeneration,
        resetChat,
        loadMessages,
    } = base;

    const handleVersionChange = useCallback((messageId: string, newIndex: number) => {
        const messagesToSave: { id: string; index: number }[] = [];

        setMessages((prev) => {
            const newMessages = [...prev];
            const msgIndex = newMessages.findIndex((m) => m.id === messageId);
            if (msgIndex === -1) return prev;

            const message = newMessages[msgIndex];
            if (!message.versions || newIndex < 0 || newIndex >= message.versions.length) {
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
                    (m, i) => i > msgIndex && m.role === "assistant" && m.versions?.some(v => v.versionId === version.pairedAssistantVersionId)
                );
                if (assistantMsgIndex !== -1) {
                    const assistantMsg = newMessages[assistantMsgIndex];
                    const pairedIdx = assistantMsg.versions!.findIndex(
                        (v) => v.versionId === version.pairedAssistantVersionId
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
                            researchReport: assistantMsg.versions![pairedIdx].researchReport,
                        };
                        messagesToSave.push({ id: assistantMsg.id, index: pairedIdx });
                    }
                }
            }

            // 2. Assistant message switched -> Ensure preceding user message matches
            if (message.role === "assistant" && version.pairedUserVersionId) {
                const userMsgIndex = newMessages.findIndex(
                    (m, i) => i < msgIndex && m.role === "user" && m.versions?.some(v => v.versionId === version.pairedUserVersionId)
                );
                if (userMsgIndex !== -1) {
                    const userMsg = newMessages[userMsgIndex];
                    const pairedIdx = userMsg.versions!.findIndex(
                        (v) => v.versionId === version.pairedUserVersionId
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
                }).catch((err) => console.error("Failed to save active version index:", err));
            });
        }
    }, [setMessages, threadId]);

    const sendMessage = useCallback(async (
        attachments: FileAttachment[] = [],
        overrideMessage?: string,
        regenerateMessageId?: string,
        editMessageId?: string,
    ) => {
        const isRegeneration = Boolean(regenerateMessageId);
        const isEdit = Boolean(editMessageId);
        const messageContent = (overrideMessage ?? input).trim();
        if ((!messageContent && attachments.length === 0 && !isRegeneration) || isLoading) return;        
        if ((isRegeneration || isEdit) && !threadId) return;

        const endpoint = "/api/multi-agent/stream";
        const modelToUse = options.selectedModel || selectedModel;
        let pendingUserMessageId: string | null = null;

        if (!isRegeneration && !isEdit) {
            const userMessage = createUserMessage(messageContent, threadId || "", attachments);
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
                        : message
                )
            );
        } else if (isEdit && editMessageId) {
            let nextStreamingMessageId: string | null = null;
            setMessages((prev) => {
                const nextMessages = [...prev];
                const editIdx = nextMessages.findIndex(
                    (message) => message.id === editMessageId
                );
                if (editIdx === -1) {
                    return prev;
                }

                nextMessages[editIdx] = {
                    ...nextMessages[editIdx],
                    content: messageContent,
                    model: modelToUse,
                };

                if (
                    editIdx + 1 < nextMessages.length &&
                    nextMessages[editIdx + 1].role === "assistant"
                ) {
                    nextStreamingMessageId = nextMessages[editIdx + 1].id;
                    nextMessages[editIdx + 1] = {
                        ...nextMessages[editIdx + 1],
                        content: "",
                        model: modelToUse,
                        toolCalls: undefined,
                        citations: undefined,
                        researchReport: undefined,
                    };
                } else {
                    const assistantMessage = createAssistantMessage(threadId || "", modelToUse);
                    nextStreamingMessageId = assistantMessage.id;
                    nextMessages.splice(
                        editIdx + 1,
                        0,
                        assistantMessage
                    );
                }

                return nextMessages;
            });
            setStreamingMessageId(nextStreamingMessageId);
        }
        setIsLoading(true);
        setError(null);

        abortControllerRef.current = new AbortController();

        const updateAssistantMessage = (
            updater: (message: Message) => Message,
        ) => {
            setMessages((prev) => {
                const nextMessages = [...prev];
                let targetIdx = -1;

                if (isRegeneration && regenerateMessageId) {
                    targetIdx = nextMessages.findIndex((m) => m.id === regenerateMessageId);
                } else if (isEdit && editMessageId) {
                    const editIdx = nextMessages.findIndex((m) => m.id === editMessageId);
                    if (editIdx !== -1 && editIdx + 1 < nextMessages.length && nextMessages[editIdx + 1].role === "assistant") {
                        targetIdx = editIdx + 1;
                    } else if (editIdx !== -1) {
                        const assistantMessage = createAssistantMessage(threadId || "", modelToUse);
                        nextMessages.splice(editIdx + 1, 0, assistantMessage);
                        targetIdx = editIdx + 1;
                    }
                } else {
                    targetIdx = nextMessages.findLastIndex(
                        (message) => message.role === "assistant" && !message.agentId, 
                    );
                }

                if (targetIdx < 0 || nextMessages[targetIdx].role !== "assistant") {
                    return prev;
                }

                nextMessages[targetIdx] = updater(nextMessages[targetIdx]);  
                return nextMessages;
            });
        };

        const updatePendingUserMessageId = (savedMessageId: string) => {
            if (!pendingUserMessageId) return;

            setMessages((prev) =>
                prev.map((message) =>
                    message.id === pendingUserMessageId
                        ? { ...message, id: savedMessageId }
                        : message
                )
            );
            pendingUserMessageId = savedMessageId;
        };

        try {
            const documents = attachments.filter(a => a.type === "document");
            const images = attachments.filter(a => a.type === "image");
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
                    temperature,
                    topP,
                    documents: documentsPayload,
                    images: imagesPayload,
                    regenerateMessageId: isRegeneration ? regenerateMessageId : undefined,
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
            let currentAgentName: string | undefined = undefined;
            let sseBuffer = "";

            let lastUpdateTime = 0;
            if (!isRegeneration && !isEdit) {
                const assistantMessage = createAssistantMessage(threadId || "", modelToUse || DEFAULT_MODEL_ID);
                setStreamingMessageId(assistantMessage.id);
                setMessages((prev) => [...prev, assistantMessage]);
            }

            const updateAssistantToolCalls = (
                updater: (toolCalls: ToolCall[]) => ToolCall[],
            ) => {
                updateAssistantMessage((message) => ({
                    ...message,
                    toolCalls: updater(message.toolCalls || []),
                }));
            };

            const updateSubAgentToolCall = (
                parentToolCallId: string,
                updater: (toolCall: ToolCall) => ToolCall,
            ) => {
                updateAssistantToolCalls((toolCalls) =>
                    toolCalls.map((toolCall) =>
                        toolCall.id === parentToolCallId
                            ? updater(toolCall)
                            : toolCall,
                    ),
                );
            };

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
                                    }))
                                );
                                fetchThreads();
                                invalidateThreads();
                                break;

                            case "token":
                                if (data.parentToolCallId) {
                                    updateSubAgentToolCall(
                                        data.parentToolCallId,
                                        (toolCall) => {
                                            const fallbackAgentId =
                                                data.agentId ||
                                                toolCall.subAgentMessage?.agentId;
                                            const fallbackAgentName =
                                                data.agentName ||
                                                toolCall.subAgentMessage?.agentName ||
                                                "Sub-agent";

                                            if (!fallbackAgentId) {
                                                return toolCall;
                                            }

                                            return {
                                                ...toolCall,
                                                subAgentMessage: {
                                                    content: `${toolCall.subAgentMessage?.content || ""}${data.content || ""}`,
                                                    agentId: fallbackAgentId,
                                                    agentName: fallbackAgentName,
                                                    toolCalls: toolCall.subAgentMessage?.toolCalls,
                                                },
                                            };
                                        },
                                    );
                                    break;
                                }

                                assistantContent += data.content || "";
                                currentAgentName = data.agentName;

                                // Throttle updates
                                if (Date.now() - lastUpdateTime > 50) {
                                    updateAssistantMessage((message) => ({
                                        ...message,
                                        content: assistantContent,
                                        agentName: currentAgentName || message.agentName,
                                    }));
                                    lastUpdateTime = Date.now();
                                }
                                break;

                            case "tool_start":
                                if (data.parentToolCallId) {
                                    updateSubAgentToolCall(
                                        data.parentToolCallId,
                                        (toolCall) => {
                                            const fallbackAgentId =
                                                data.agentId ||
                                                toolCall.subAgentMessage?.agentId;
                                            const fallbackAgentName =
                                                data.agentName ||
                                                toolCall.subAgentMessage?.agentName ||
                                                "Sub-agent";

                                            if (!fallbackAgentId) {
                                                return toolCall;
                                            }

                                            return {
                                                ...toolCall,
                                                subAgentMessage: {
                                                    content: toolCall.subAgentMessage?.content || "",
                                                    agentId: fallbackAgentId,
                                                    agentName: fallbackAgentName,
                                                    toolCalls: upsertToolCall(
                                                        toolCall.subAgentMessage?.toolCalls,
                                                        data.toolCall,
                                                    ),
                                                },
                                            };
                                        },
                                    );
                                    break;
                                }

                                updateAssistantToolCalls((toolCalls) =>
                                    upsertToolCall(toolCalls, data.toolCall),
                                );
                                break;

                            case "tool_result":
                                if (data.parentToolCallId) {
                                    updateSubAgentToolCall(
                                        data.parentToolCallId,
                                        (toolCall) => {
                                            if (!toolCall.subAgentMessage?.toolCalls) {
                                                return toolCall;
                                            }

                                            return {
                                                ...toolCall,
                                                subAgentMessage: {
                                                    ...toolCall.subAgentMessage,
                                                    toolCalls: toolCall.subAgentMessage.toolCalls.map((subToolCall) =>
                                                        subToolCall.id === data.toolCallId
                                                            ? { ...subToolCall, result: data.result }
                                                            : subToolCall,
                                                    ),
                                                },
                                            };
                                        },
                                    );
                                    break;
                                }

                                updateAssistantToolCalls((toolCalls) =>
                                    toolCalls.map((toolCall) =>
                                        toolCall.id === data.toolCallId
                                            ? { ...toolCall, result: data.result }
                                            : toolCall,
                                    ),
                                );
                                break;

                            case "citations":
                                updateAssistantMessage((message) => ({
                                    ...message,
                                    citations: data.citations,
                                }));
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
                                if (threadId || newThreadId) {
                                    await loadMessages(threadId || newThreadId!);
                                }
                                break;
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }

            if (assistantContent) {
                updateAssistantMessage((message) => ({
                    ...message,
                    content: assistantContent,
                    agentName: currentAgentName || message.agentName,
                }));
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
        }
    }, [input, isLoading, threadId, selectedModel, agentId, systemPrompt, temperature, topP, fetchThreads, invalidateThreads, options.selectedModel, setMessages, setInput, setIsLoading, setError, abortControllerRef, setThreadId, setThreadTitle, updateThreadTitle, loadMessages]); 

    const handleFeedbackChange = useCallback((messageId: string, versionId: string, feedback: "like" | "dislike" | null) => {
        setMessages((prev) => {
            const newMessages = [...prev];
            const msgIndex = newMessages.findIndex((m) => m.id === messageId);
            if (msgIndex === -1) return prev;

            const message = newMessages[msgIndex];
            if (!message.versions) return prev;

            const updatedVersions = message.versions.map((v) =>
                v.versionId === versionId ? { ...v, feedback: feedback || undefined } : v
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
    }, [setMessages]);

    return {
        messages,
        input,
        setInput,
        sendMessage,
        isLoading,
        selectedModel,
        setSelectedModel,
        threadId,
        threadTitle,
        error,
        stopGeneration,
        resetChat,
        loadMessages,
        handleVersionChange,
        handleFeedbackChange,
        streamingMessageId,
    };
}
