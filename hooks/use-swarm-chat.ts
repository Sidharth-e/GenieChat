"use client";

import { useCallback, useState, useRef } from "react";
import { SendMessageOptions, ToolCall } from "@/lib/types";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";
import {
    useChatBase,
    UseChatOptions,
    FileAttachment,
    createUserMessage,
    createAssistantMessage,
} from "./use-chat-base";
import { parseSseChunk } from "@/lib/utils/sse";
import { useMachineStateStore } from "@/lib/stores";

function upsertToolCall(toolCalls: ToolCall[] | undefined, nextToolCall: ToolCall) {
    const existingToolCalls = toolCalls || [];
    if (existingToolCalls.some((tc) => tc.id === nextToolCall.id)) {
        return existingToolCalls;
    }
    return [...existingToolCalls, nextToolCall];
}

export interface UseSwarmChatOptions extends UseChatOptions {
    swarmAgentIds: string[];
}

export function useSwarmChat(options: UseSwarmChatOptions) {
    const { swarmAgentIds, temperature, topP } = options;
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
    const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
    const [currentRound, setCurrentRound] = useState<number>(0);
    const [routingReason, setRoutingReason] = useState<"mention" | "llm_fallback" | null>(null);
    const streamingMessageIdRef = useRef<string | null>(null);
    const agentMessageMapRef = useRef(new Map<string, string>());

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

    const sendMessage = useCallback(async (
        attachments: FileAttachment[] = [],
        sendOptions: SendMessageOptions = {},
    ) => {
        const { message: overrideMessage } = sendOptions;
        const messageContent = (overrideMessage ?? input).trim();
        if ((!messageContent && attachments.length === 0) || isLoading) return;

        const endpoint = "/api/swarm/stream";
        const modelToUse = options.selectedModel || selectedModel;
        let pendingUserMessageId: string | null = null;

        const userMessage = createUserMessage(messageContent, threadId || "", attachments);
        pendingUserMessageId = userMessage.id;
        setMessages((prev) => [...prev, userMessage]);
        if (overrideMessage === undefined) {
            setInput("");
        }

        setIsLoading(true);
        setError(null);
        setCurrentRound(0);
        setRoutingReason(null);
        useMachineStateStore.getState().setMachineStatus("streaming");
        useMachineStateStore.getState().setLiveTokens(null);
        useMachineStateStore.getState().addAuditLog({
            action: "Swarm prompt submitted",
            detail: messageContent.slice(0, 80),
            type: "user",
        });

        abortControllerRef.current = new AbortController();

        try {
            const documents = attachments.filter(a => a.type === "document");
            const images = attachments.filter(a => a.type === "image");

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    threadId,
                    message: messageContent,
                    model: modelToUse,
                    swarmAgentIds,
                    temperature,
                    topP,
                    documents: documents.length ? documents : undefined,
                    images: images.length ? images : undefined,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error("Failed to send message");
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let newThreadId: string | null = null;
            let sseBuffer = "";

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

                            case "user_message_saved":
                                if (pendingUserMessageId) {
                                    setMessages((prev) =>
                                        prev.map((msg) =>
                                            msg.id === pendingUserMessageId
                                                ? { ...msg, id: data.messageId }
                                                : msg
                                        )
                                    );
                                    pendingUserMessageId = data.messageId;
                                }
                                break;

                            case "routing":
                                setActiveAgentIds(
                                    data.routedAgents?.map((name: string) => name) ?? [],
                                );
                                setRoutingReason(data.routingReason ?? null);
                                break;

                            case "round_start":
                                setCurrentRound(data.round ?? 0);
                                break;

                            case "round_end":
                                break;

                            case "agent_turn_start": {
                                const agentMessage = createAssistantMessage(
                                    threadId || newThreadId || "",
                                    modelToUse || DEFAULT_MODEL_ID,
                                );
                                agentMessage.agentId = data.agentId;
                                agentMessage.agentName = data.agentName;
                                streamingMessageIdRef.current = agentMessage.id;
                                setStreamingMessageId(agentMessage.id);
                                if (data.agentId) {
                                    agentMessageMapRef.current.set(data.agentId, agentMessage.id);
                                }
                                setActiveAgentIds((prev) => {
                                    if (prev.includes(data.agentId)) return prev;
                                    return [...prev, data.agentId];
                                });
                                setMessages((prev) => [...prev, agentMessage]);
                                break;
                            }

                            case "token": {
                                const targetId = (data.agentId && agentMessageMapRef.current.get(data.agentId))
                                    || streamingMessageIdRef.current;
                                if (!targetId || !data.content) break;

                                setMessages((prev) => {
                                    const next = [...prev];
                                    const idx = next.findIndex((m) => m.id === targetId);
                                    if (idx >= 0) {
                                        next[idx] = {
                                            ...next[idx],
                                            content: next[idx].content + (data.content || ""),
                                        };
                                    }
                                    return next;
                                });
                                break;
                            }

                            case "tool_start": {
                                useMachineStateStore.getState().setMachineStatus("executing_tool", data.toolCall?.name);
                                useMachineStateStore.getState().addAuditLog({
                                    action: `Tool call: ${data.toolCall?.name || "tool"}`,
                                    detail: typeof data.toolCall?.arguments === "object" ? JSON.stringify(data.toolCall.arguments).slice(0, 100) : "",
                                    type: "tool",
                                });
                                const targetId = (data.agentId && agentMessageMapRef.current.get(data.agentId))
                                    || streamingMessageIdRef.current;
                                if (!targetId) break;
                                setMessages((prev) => {
                                    const next = [...prev];
                                    const idx = next.findIndex((m) => m.id === targetId);
                                    if (idx >= 0) {
                                        next[idx] = {
                                            ...next[idx],
                                            toolCalls: upsertToolCall(next[idx].toolCalls, data.toolCall),
                                        };
                                    }
                                    return next;
                                });
                                break;
                            }

                            case "tool_result": {
                                useMachineStateStore.getState().setMachineStatus("streaming");
                                useMachineStateStore.getState().addAuditLog({
                                    action: `Tool finished: ${data.toolCallId || "tool"}`,
                                    detail: typeof data.result === "string" ? data.result.slice(0, 80) : "Result received",
                                    type: "tool",
                                });
                                const targetId = (data.agentId && agentMessageMapRef.current.get(data.agentId))
                                    || streamingMessageIdRef.current;
                                if (!targetId) break;
                                setMessages((prev) => {
                                    const next = [...prev];
                                    const idx = next.findIndex((m) => m.id === targetId);
                                    if (idx >= 0) {
                                        next[idx] = {
                                            ...next[idx],
                                            toolCalls: (next[idx].toolCalls || []).map((tc) =>
                                                tc.id === data.toolCallId
                                                    ? { ...tc, result: data.result }
                                                    : tc,
                                            ),
                                        };
                                    }
                                    return next;
                                });
                                break;
                            }

                            case "token_usage": {
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
                                const targetId = (data.agentId && agentMessageMapRef.current.get(data.agentId))
                                    || streamingMessageIdRef.current;
                                if (targetId) {
                                    setMessages((prev) => {
                                        const next = [...prev];
                                        const idx = next.findIndex((m) => m.id === targetId);
                                        if (idx >= 0) {
                                            next[idx] = {
                                                ...next[idx],
                                                tokens: {
                                                    prompt: data.promptTokens,
                                                    completion: data.completionTokens,
                                                },
                                            };
                                        }
                                        return next;
                                    });
                                }
                                break;
                            }

                            case "agent_turn_end": {
                                const targetId = (data.agentId && agentMessageMapRef.current.get(data.agentId))
                                    || streamingMessageIdRef.current;
                                if (targetId && data.messageId) {
                                    setMessages((prev) =>
                                        prev.map((m) =>
                                            m.id === targetId
                                                ? { ...m, id: data.messageId }
                                                : m
                                        )
                                    );
                                }
                                if (data.agentId) {
                                    agentMessageMapRef.current.delete(data.agentId);
                                }
                                if (agentMessageMapRef.current.size === 0) {
                                    streamingMessageIdRef.current = null;
                                    setStreamingMessageId(null);
                                }
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
                                useMachineStateStore.getState().setMachineStatus("error");
                                useMachineStateStore.getState().addAuditLog({
                                    action: "Stream error",
                                    detail: String(data.error),
                                    type: "system",
                                });
                                setError(data.error);
                                break;

                            case "done":
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
                setMessages((prev) => prev.slice(0, -1));
            }
        } finally {
            setIsLoading(false);
            setStreamingMessageId(null);
            setActiveAgentIds([]);
            setCurrentRound(0);
            setRoutingReason(null);
            streamingMessageIdRef.current = null;
            agentMessageMapRef.current.clear();
            abortControllerRef.current = null;
            useMachineStateStore.getState().setMachineStatus("idle");
        }
    }, [input, isLoading, threadId, selectedModel, swarmAgentIds, temperature, topP, fetchThreads, invalidateThreads, options.selectedModel, setMessages, setInput, setIsLoading, setError, abortControllerRef, setThreadId, setThreadTitle, updateThreadTitle]);

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
        streamingMessageId,
        activeAgentIds,
        currentRound,
        routingReason,
    };
}
