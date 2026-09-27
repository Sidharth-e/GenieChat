"use client";

import { logger } from "@/lib/logger";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useChatSettings,
  useThreadsStore,
  usePendingMessageStore,
  useQuickActionsStore,
} from "@/lib/stores";
import { QuickAction } from "@/lib/types";

export function useQuickActionsHandler() {
  const router = useRouter();
  const { selectedModel } = useChatSettings();
  const addThread = useThreadsStore((state) => state.addThread);
  const setPendingMessage = usePendingMessageStore(
    (state) => state.setPendingMessage,
  );
  const { setIsModalOpen } = useQuickActionsStore();
  const [executingActionId, setExecutingActionId] = useState<string | null>(
    null,
  );

  const executeQuickAction = async (action: QuickAction) => {
    setExecutingActionId(action.id);
    try {
      if (action.medium === "chat") {
        const res = await fetch("/api/chat/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel }),
        });

        if (!res.ok) throw new Error("Failed to create thread");
        const thread = await res.json();
        addThread(thread);
        setPendingMessage(thread.id, action.prompt, [], false);
        router.push(`/chat/${thread.id}`);
      } else if (action.medium === "agent") {
        // Fetch agent to check type (simplified: assume standard for now or fetch list)
        const agentRes = await fetch("/api/agents");
        const agents: Array<{ id: string; subAgents?: unknown[] }> = await agentRes.json();
        const agent = agents.find((a) => a.id === action.agentId);

        const isMultiAgent = Boolean(
          Array.isArray(agent?.subAgents) && agent.subAgents.length > 0,
        );
        const pathPrefix = isMultiAgent ? "multi-agent-chat" : "agent-chat";

        const res = await fetch("/api/chat/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            agentId: action.agentId,
            isMultiAgent,
          }),
        });

        if (!res.ok) throw new Error("Failed to create agent thread");
        const thread = await res.json();
        addThread(thread);
        setPendingMessage(thread.id, action.prompt, [], false);
        router.push(`/${pathPrefix}/${action.agentId}/${thread.id}`);
      }
      setIsModalOpen(false);
    } catch (error) {
      logger.error("Failed to execute quick action", error);
    } finally {
      setExecutingActionId(null);
    }
  };

  return {
    executeQuickAction,
    executingActionId,
  };
}
