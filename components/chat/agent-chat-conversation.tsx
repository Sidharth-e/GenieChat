"use client";

import * as React from "react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { AgentConversationView } from "./agent-conversation-view";
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

  return <AgentConversationView agent={agent} threadId={threadId} chat={chat} />;
}
