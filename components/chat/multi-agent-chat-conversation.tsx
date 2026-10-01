"use client";

import * as React from "react";
import { useMultiAgentChat } from "@/hooks/use-multi-agent-chat";
import { AgentConversationView } from "./agent-conversation-view";
import { Message, Agent } from "@/lib/types";
import { usePendingMessageStore } from "@/lib/stores";

interface MultiAgentChatConversationProps {
  agent: Agent;
  threadId: string;
  initialMessages?: Message[];
}

export function MultiAgentChatConversation({
  agent,
  threadId,
  initialMessages,
}: MultiAgentChatConversationProps) {
  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );

  // Resolved before the chat hook runs, because it decides whether the hook
  // skips its initial message load.
  const hasPendingMessage = React.useMemo(() => {
    return !!getPendingMessage(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only check on mount

  const chat = useMultiAgentChat({
    threadId,
    initialMessages,
    agentId: agent.id,
    systemPrompt: agent.systemPrompt,
    selectedModel: agent.modelId,
    temperature: agent.temperature,
    topP: agent.topP,
    skipInitialLoad: hasPendingMessage,
  });

  return (
    <AgentConversationView
      agent={agent}
      threadId={threadId}
      chat={chat}
      isMultiAgent
    />
  );
}
