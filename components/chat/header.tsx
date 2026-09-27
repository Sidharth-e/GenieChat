"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMachineStateStore } from "@/lib/stores";
import { useThreads } from "@/hooks/use-threads-queries";
import { useAgents } from "@/hooks/use-agents-queries";

interface HeaderProps {
  inlineOnMobile?: boolean;
}

export function Header({ inlineOnMobile = false }: HeaderProps) {
  const pathname = usePathname();
  const { isOpen: isMachineStateOpen, toggle: toggleMachineState } =
    useMachineStateStore();

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

  const currentThread = threads?.find((t) => t.id === threadId);
  const currentAgent = agents.find((a) => a.id === agentId);

  const threadTitle =
    currentThread?.title ||
    (currentAgent ? currentAgent.name : "Conversation");

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
