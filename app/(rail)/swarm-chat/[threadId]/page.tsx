"use client";

import { useEffect, useState } from "react";
import { SwarmChatConversation } from "@/components/chat/swarm-chat-conversation";
import { ConversationSkeleton } from "@/components/chat/agent-chat-skeleton";

interface SwarmChatThreadPageProps {
  params: Promise<{ threadId: string }>;
}

export default function SwarmChatThreadPage({
  params,
}: SwarmChatThreadPageProps) {
  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => {
      setThreadId(p.threadId);
    });
  }, [params]);

  if (!threadId) {
    return <ConversationSkeleton />;
  }

  return <SwarmChatConversation threadId={threadId} />;
}
