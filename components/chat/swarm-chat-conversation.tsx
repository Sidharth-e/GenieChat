"use client";

import * as React from "react";
import { useSwarmChat } from "@/hooks/use-swarm-chat";
import { useConversationShell } from "@/hooks/use-conversation-shell";
import { ConversationShell } from "./conversation-shell";
import { ChatInput } from "./chat-input";
import { Agent } from "@/lib/types";
import { useChatSettings, usePendingMessageStore, useThreadsStore } from "@/lib/stores";
import { Network, Zap } from "lucide-react";

interface SwarmChatConversationProps {
  threadId: string;
}

export function SwarmChatConversation({ threadId }: SwarmChatConversationProps) {
  const { selectedModel } = useChatSettings();

  const getPendingMessage = usePendingMessageStore(
    (state) => state.getPendingMessage,
  );

  // swarmAgentIds come from the pending message (new threads) or the thread
  // store (existing threads).
  const threadFromStore = useThreadsStore((state) =>
    state.threads.find((t) => t.id === threadId),
  );
  const swarmAgentIds = React.useMemo(() => {
    const pending = getPendingMessage(threadId);
    if (pending?.swarmAgentIds?.length) return pending.swarmAgentIds;
    if (threadFromStore?.swarmAgentIds?.length) return threadFromStore.swarmAgentIds;
    return [];
  }, [threadId, getPendingMessage, threadFromStore]);

  // Fetch agent details for the roster divider and the status pill.
  const [agents, setAgents] = React.useState<Agent[]>([]);
  React.useEffect(() => {
    if (swarmAgentIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      swarmAgentIds.map((id) =>
        fetch(`/api/agents/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (!cancelled) {
        setAgents(results.filter((a): a is Agent => a !== null));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [swarmAgentIds]);

  const hasPendingMessage = React.useMemo(() => {
    return !!getPendingMessage(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chat = useSwarmChat({
    threadId,
    swarmAgentIds,
    selectedModel,
    skipInitialLoad: hasPendingMessage,
  });

  const { sendMessage, activeAgentIds, currentRound } = chat;

  const dispatchPending = React.useCallback(
    (text: string, attachments: Parameters<typeof sendMessage>[0]) => {
      void sendMessage(attachments, { message: text });
    },
    [sendMessage],
  );

  const threadDefaults = React.useMemo(
    () => ({
      model: selectedModel,
      isSwarm: true,
      swarmAgentIds,
      threadType: "chat" as const,
    }),
    [selectedModel, swarmAgentIds],
  );

  const shell = useConversationShell({
    threadId,
    chat,
    threadDefaults,
    dispatchPending,
    clearDelayMs: 1000,
  });

  const activeAgentName = React.useMemo(() => {
    if (activeAgentIds.length === 0) return "Swarm";
    const names = activeAgentIds
      .map((id) => agents.find((a) => a.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(" & ") : "Agent";
  }, [activeAgentIds, agents]);

  const overlay =
    chat.isLoading && activeAgentIds.length > 0 ? (
      <div className="absolute right-4 top-3 z-20 flex items-center gap-1.5 rounded-full border border-card-border bg-card/90 px-3 py-1.5 shadow-lg backdrop-blur-sm transition-all duration-200 animate-in fade-in slide-in-from-top-2">
        <Zap className="h-3 w-3 animate-pulse text-amber-400" />
        <span className="text-[11px] font-medium text-text-primary">
          {activeAgentIds
            .map((id) => agents.find((a) => a.id === id)?.name)
            .filter(Boolean)
            .join(" & ") || "Agent"}
        </span>
        {currentRound > 0 && (
          <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
            R{currentRound}
          </span>
        )}
      </div>
    ) : null;

  const roster =
    agents.length > 0 ? (
      <div className="flex items-center justify-center gap-3 px-4 py-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-card-border to-transparent" />
        <div className="flex items-center gap-2">
          <Network className="h-3.5 w-3.5 text-text-secondary/50" />
          <span className="text-[11px] text-text-secondary/60">
            {agents.map((a) => a.name).join(" · ")}
          </span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-card-border to-transparent" />
      </div>
    ) : null;

  return (
    <ConversationShell
      messages={chat.messages}
      isLoading={chat.isLoading}
      streamingMessageId={chat.streamingMessageId}
      agentNames={shell.agentNames}
      lastAssistantMessageId={shell.lastAssistantMessageId}
      nameForMessage={(message) => message.agentName || "Assistant"}
      loadingName={activeAgentName}
      showStandaloneLoader={shell.showStandaloneLoader}
      loadingMessage={shell.loadingMessage}
      overlay={overlay}
      slotBeforeMessages={roster}
      error={chat.error}
      composer={
        <ChatInput
          value={chat.input}
          onChange={chat.setInput}
          onSubmit={(attachments) => sendMessage(attachments)}
          onStop={chat.stopGeneration}
          isLoading={chat.isLoading}
          placeholder={
            agents.length > 0
              ? `Message ${agents.map((a) => `@[${a.name}]`).join(" ")}...`
              : "Message swarm..."
          }
          contextKey={`thread-${threadId}`}
        />
      }
      scrollRef={shell.scrollRef}
      bottomRef={shell.bottomRef}
    />
  );
}
