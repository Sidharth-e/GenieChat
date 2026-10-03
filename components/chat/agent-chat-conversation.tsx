"use client";

import * as React from "react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { useConversationShell } from "@/hooks/use-conversation-shell";
import { ConversationShell } from "./conversation-shell";
import { ChatInput } from "./chat-input";
import { Message, Agent } from "@/lib/types";
import { usePendingMessageStore } from "@/lib/stores";

interface AgentChatConversationProps {
  agent: Agent;
  threadId: string;
  initialMessages?: Message[];
}

export function AgentChatConversation({
  agent,
  threadId,
  initialMessages,
}: AgentChatConversationProps) {
  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );

  // Resolved before the chat hook runs, because it decides whether the hook
  // skips its initial message load.
  const hasPendingMessage = React.useMemo(() => {
    return !!getPendingMessage(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only check on mount

  const chat = useAgentChat({
    threadId,
    initialMessages,
    agentId: agent.id,
    systemPrompt: agent.systemPrompt,
    selectedModel: agent.modelId,
    temperature: agent.temperature,
    topP: agent.topP,
    skipInitialLoad: hasPendingMessage,
  });

  const { sendMessage, selectedModel } = chat;

  const dispatchPending = React.useCallback(
    (text: string, attachments: Parameters<typeof sendMessage>[0]) => {
      void sendMessage(attachments, { message: text });
    },
    [sendMessage],
  );

  const threadDefaults = React.useMemo(
    () => ({
      model: agent.modelId || selectedModel,
      agentId: agent.id,
      isMultiAgent: false,
      threadType: "chat" as const,
    }),
    [agent.id, agent.modelId, selectedModel],
  );

  const shell = useConversationShell({
    threadId,
    chat,
    threadDefaults,
    dispatchPending,
    clearDelayMs: 1000,
  });

  return (
    <ConversationShell
      messages={chat.messages}
      isLoading={chat.isLoading}
      streamingMessageId={chat.streamingMessageId}
      agentNames={shell.agentNames}
      lastAssistantMessageId={shell.lastAssistantMessageId}
      nameForMessage={(message) => message.agentName || agent.name}
      loadingName={agent.name}
      showStandaloneLoader={shell.showStandaloneLoader}
      loadingMessage={shell.loadingMessage}
      handlers={shell.handlers}
      error={chat.error}
      composer={
        <ChatInput
          value={chat.input}
          onChange={chat.setInput}
          onSubmit={(attachments) => sendMessage(attachments)}
          onStop={chat.stopGeneration}
          isLoading={chat.isLoading}
          placeholder={`Message ${agent.name}...`}
          contextKey={`thread-${threadId}`}
        />
      }
      scrollRef={shell.scrollRef}
      bottomRef={shell.bottomRef}
    />
  );
}
