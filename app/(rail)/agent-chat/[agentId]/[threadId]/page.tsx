"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentChatConversation } from "@/components/chat/agent-chat-conversation";
import { ConversationSkeleton } from "@/components/chat/agent-chat-skeleton";
import { useAgent } from "@/hooks/use-agents-queries";

interface AgentChatThreadPageProps {
  params: Promise<{ agentId: string; threadId: string }>;
}

export default function AgentChatThreadPage({
  params,
}: AgentChatThreadPageProps) {
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => {
      setAgentId(p.agentId);
      setThreadId(p.threadId);
    });
  }, [params]);

  // Server state from React Query
  const { data: agent, isLoading } = useAgent(agentId);

  if (isLoading || !agentId || !threadId) {
    return <ConversationSkeleton />;
  }

  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Agent not found
        </h2>
        <p className="text-text-secondary mb-4">
          The agent you&apos;re looking for doesn&apos;t exist.
        </p>
        <button
          onClick={() => router.push("/agents")}
          className="text-primary hover:underline"
        >
          Back to Agents
        </button>
      </div>
    );
  }

  if (!agent.active) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Agent Disabled
        </h2>
        <p className="text-text-secondary mb-4">
          This agent has been disabled and cannot be used for chat.
        </p>
        <button
          onClick={() => router.push("/agents")}
          className="text-primary hover:underline"
        >
          Back to Agents
        </button>
      </div>
    );
  }

  return <AgentChatConversation agent={agent} threadId={threadId} />;
}
