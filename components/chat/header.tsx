"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Settings2, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMachineStateStore, useChatSettings } from "@/lib/stores";
import { useThreads, useThreadMessages } from "@/hooks/use-threads-queries";
import { useAgents } from "@/hooks/use-agents-queries";
import {
  formatModelName,
  JEV_ROUTER_MODEL_ID,
} from "@/lib/langchain/model-config";

interface HeaderProps {
  inlineOnMobile?: boolean;
}

export function Header({ inlineOnMobile = false }: HeaderProps) {
  const pathname = usePathname();
  const {
    isOpen: isMachineStateOpen,
    toggle: toggleMachineState,
    liveRoutedModel,
    liveTokens,
  } = useMachineStateStore();

  const chatMatch = pathname?.match(/^\/chat\/([^/]+)/);
  const agentChatMatch = pathname?.match(/^\/agent-chat\/([^/]+)(?:\/([^/]+))?/);
  const multiAgentChatMatch = pathname?.match(
    /^\/multi-agent-chat\/([^/]+)(?:\/([^/]+))?/,
  );
  const swarmChatMatch = pathname?.match(/^\/swarm-chat\/([^/]+)/);

  const threadId =
    chatMatch?.[1] ||
    agentChatMatch?.[2] ||
    multiAgentChatMatch?.[2] ||
    swarmChatMatch?.[1];

  const agentId = agentChatMatch?.[1] || multiAgentChatMatch?.[1];

  const { data: threads } = useThreads();
  const { data: agents = [] } = useAgents(undefined, {
    enabled: Boolean(agentId),
  });
  const { selectedModel } = useChatSettings();
  const { data: messages = [] } = useThreadMessages(threadId);

  const currentThread = threads?.find((t) => t.id === threadId);
  const currentAgent = agents.find((a) => a.id === agentId);

  const threadTitle =
    currentThread?.title ||
    (currentAgent ? currentAgent.name : "Conversation");

  const threadRoutedModel = useMemo(() => {
    if (liveRoutedModel) return liveRoutedModel;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].routedModel) {
        return messages[i].routedModel;
      }
    }
    return null;
  }, [liveRoutedModel, messages]);

  const isAutoMode =
    selectedModel === JEV_ROUTER_MODEL_ID ||
    currentThread?.model === JEV_ROUTER_MODEL_ID ||
    Boolean(threadRoutedModel) ||
    messages.some(
      (m) => m.model === JEV_ROUTER_MODEL_ID || Boolean(m.routedModel),
    );

  return (
    <motion.div
      layout
      className={cn(
        "z-50 w-full",
        inlineOnMobile ? "relative" : "relative lg:relative",
      )}
    >
      <div className="relative flex w-full items-center justify-between gap-3 bg-background/95 backdrop-blur-sm px-4 py-2.5 sm:gap-4 sm:px-6 border-b border-card-border">
        <div className="flex items-center min-w-0 gap-2">
          <h1 className="text-sm font-medium text-foreground truncate max-w-[240px] sm:max-w-md">
            {threadTitle}
          </h1>
          {currentAgent && currentThread?.title && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-tertiary/40 bg-tertiary/5 px-2 py-0.5 rounded-xs shrink-0">
              {currentAgent.name}
            </span>
          )}
        </div>

        <motion.div
          className="flex items-center justify-end gap-1.5 sm:gap-2"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {isAutoMode && (
            <motion.button
              variants={{
                hidden: { opacity: 0, y: -4 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.2 }}
              onClick={() => toggleMachineState()}
              className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15 transition-colors cursor-pointer"
              title="System Telemetry"
            >
              <Box className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[130px] sm:max-w-[200px]">
                {threadRoutedModel
                  ? `Auto → ${formatModelName(threadRoutedModel)}`
                  : "Auto Mode"}
              </span>
              {liveTokens && liveTokens.total > 0 && (
                <span className="text-[10px] opacity-75 font-mono">
                  {liveTokens.total}t
                </span>
              )}
            </motion.button>
          )}

          <motion.button
            variants={{
              hidden: { opacity: 0, y: -4 },
              visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.2 }}
            onClick={() => toggleMachineState()}
            className={cn(
              "group relative overflow-hidden rounded-sm p-2 cursor-pointer text-tertiary/50 transition-all duration-200 hover:bg-tertiary/8 hover:text-foreground",
              isMachineStateOpen && "bg-tertiary/8 text-foreground",
            )}
            aria-label="System telemetry"
            title="System Telemetry"
          >
            <Settings2 className="h-5 w-5 transition-transform group-hover:scale-110" />
            <span className="sr-only">System Telemetry</span>
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}
