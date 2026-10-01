"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText } from "lucide-react";
import { ChatInput } from "./chat-input";
import {
  useChatSettings,
  usePendingMessageStore,
  useArenaStore,
} from "@/lib/stores";
import { useAuthStore } from "@/lib/auth";
import { ChatAttachment, Agent, ReasoningEffort } from "@/lib/types";
import type { DeepResearchDepth } from "@/lib/deep-research";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { generateId } from "@/lib/utils";
import { ArenaModelSelector } from "./arena-model-selector";
import { useAgents } from "@/hooks/use-agents-queries";
import { useThreads, useRecentThreads } from "@/hooks/use-threads-queries";
import { getThreadRoute } from "@/constants/nav-routes";
import { formatRelativeTime } from "@/lib/relative-time";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeChatInterface() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading] = useState(false);
  const { selectedModel, setSelectedModel } = useChatSettings();
  const setPendingMessage = usePendingMessageStore(
    (state) => state.setPendingMessage,
  );
  const [isDeepResearchEnabled, setIsDeepResearchEnabled] = useState(false);
  const [deepResearchDepth, setDeepResearchDepth] =
    useState<DeepResearchDepth>("medium");
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("off");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Agent[]>([]);

  const modelSupportsReasoning =
    AVAILABLE_MODELS.find((m) => m.id === selectedModel)?.supportReasoning ??
    false;

  const { data: agents = [] } = useAgents();
  const { data: threads } = useThreads();
  const { data: recentThreads } = useRecentThreads(5);
  const isArenaMode = useArenaStore((state) => state.isArenaMode);
  const arenaSelectedModels = useArenaStore((state) => state.selectedModels);

  const isReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const user = useAuthStore((state) => state.user);
  const userName = user?.name ? user.name.split(" ")[0] : "";
  const greeting = getGreeting();

  const handleSubmit = async (attachments: ChatAttachment[] = []) => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const nextThreadId = generateId();
    const messageContent = input.trim();

    const lowerContent = messageContent.toLowerCase();
    const mentionedAgents = agents.filter((a) =>
      lowerContent.includes(`@${a.name.toLowerCase()}`),
    );

    if (mentionedAgents.length >= 2) {
      setPendingMessage(nextThreadId, messageContent, attachments, false, {
        swarmAgentIds: mentionedAgents.map((a) => a.id),
      });
      setInput("");
      setSelectedAgents([]);
      router.push(`/swarm-chat/${nextThreadId}`);
      return;
    }

    if (mentionedAgents.length === 1) {
      const agent = mentionedAgents[0];
      setPendingMessage(nextThreadId, messageContent, attachments);
      setInput("");
      setSelectedAgents([]);
      const isMultiAgent = agent.subAgents && agent.subAgents.length > 0;
      if (isMultiAgent) {
        router.push(`/multi-agent-chat/${agent.id}/${nextThreadId}`);
      } else {
        router.push(`/agent-chat/${agent.id}/${nextThreadId}`);
      }
      return;
    }

    if (selectedAgents.length >= 2) {
      setPendingMessage(nextThreadId, messageContent, attachments, false, {
        swarmAgentIds: selectedAgents.map((a) => a.id),
      });
      setInput("");
      setSelectedAgents([]);
      router.push(`/swarm-chat/${nextThreadId}`);
      return;
    }
    if (selectedAgents.length === 1) {
      const agent = selectedAgents[0];
      setPendingMessage(nextThreadId, messageContent, attachments);
      setInput("");
      setSelectedAgents([]);
      const isMultiAgent = agent.subAgents && agent.subAgents.length > 0;
      if (isMultiAgent) {
        router.push(`/multi-agent-chat/${agent.id}/${nextThreadId}`);
      } else {
        router.push(`/agent-chat/${agent.id}/${nextThreadId}`);
      }
      return;
    }

    if (isDeepResearchEnabled) {
      setPendingMessage(nextThreadId, messageContent, attachments, false, {
        isResearch: true,
        deepResearchDepth,
      });
      setInput("");
      router.push(`/chat/${nextThreadId}`);
      return;
    }

    setPendingMessage(
      nextThreadId,
      messageContent,
      attachments,
      isWebSearchEnabled,
      {
        ...(isArenaMode && arenaSelectedModels.length >= 2
          ? { isArena: true, arenaModels: arenaSelectedModels }
          : {}),
      },
    );
    setInput("");
    router.push(`/chat/${nextThreadId}`);
  };

  if (!isReady) {
    return (
      <div className="relative flex flex-1 h-full min-h-0 flex-col overflow-hidden font-sans animate-pulse">
        <section className="flex-1 overflow-y-auto px-6 py-10 md:px-10 lg:px-12 pb-48">
          <div className="mx-auto w-full max-w-7xl">
            <header className="mb-14">
              <div className="h-3 w-28 bg-card-border rounded-xs mb-4" />
              <div className="h-12 w-96 bg-card-border rounded-xs" />
            </header>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-14">
              <div className="h-28 border border-card-border bg-card-bg rounded-sm" />
              <div className="h-28 border border-card-border bg-card-bg rounded-sm" />
              <div className="h-28 border border-dashed border-card-border rounded-sm" />
            </div>
            <div className="w-full">
              <div className="h-4 w-36 bg-card-border rounded-xs mb-4" />
              <div className="space-y-2">
                <div className="h-10 border border-card-border bg-card-bg rounded-sm" />
                <div className="h-10 border border-card-border bg-card-bg rounded-sm" />
              </div>
            </div>
          </div>
        </section>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-end px-6 pb-6 pt-12 bg-gradient-to-t from-background via-background/80 to-transparent">
          <div className="w-full max-w-3xl lg:max-w-4xl h-24 border border-card-border bg-card-bg rounded-sm" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 h-full min-h-0 flex-col overflow-hidden">
      <section className="flex-1 overflow-y-auto px-6 py-10 md:px-10 lg:px-12 pb-48">
        <div className="mx-auto w-full max-w-7xl">
          <header className="mb-14">
            <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-tight text-foreground">
              {userName ? (
                <>
                  {greeting},
                  <span className="block text-5xl md:text-6xl lg:text-7xl italic gradient-text mt-1">
                    {userName}.
                  </span>
                </>
              ) : (
                <>{greeting}.</>
              )}
            </h1>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-14">
            <div className="border border-card-border p-6 bg-card-bg flex flex-col group hover:border-tertiary/40 transition-colors rounded-sm">
              <span className="font-mono text-[10px] text-tertiary/40 uppercase tracking-wider mb-2">
                Agent Fleet
              </span>
              <span className="font-serif text-3xl text-foreground">
                {agents.filter((a) => a.active).length}{" "}
                <span className="font-sans text-sm text-[var(--green)] inline-flex items-center gap-1.5 ml-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />{" "}
                  Online
                </span>
              </span>
            </div>

            <div className="border border-card-border p-6 bg-card-bg flex flex-col group hover:border-tertiary/40 transition-colors rounded-sm">
              <span className="font-mono text-[10px] text-tertiary/40 uppercase tracking-wider mb-2">
                Workspaces
              </span>
              <span className="font-serif text-3xl text-foreground">
                {threads?.length ?? "—"}{" "}
                <span className="font-sans text-sm text-tertiary/40 ml-1">
                  conversations
                </span>
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                const textarea =
                  document.querySelector<HTMLTextAreaElement>(".composer textarea") ||
                  document.querySelector<HTMLTextAreaElement>("textarea");
                textarea?.focus();
              }}
              className="border border-dashed border-card-border p-6 flex flex-col items-center justify-center hover:border-tertiary/60 transition-colors group cursor-pointer text-tertiary/50 hover:text-foreground rounded-sm"
            >
              <Plus className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform" />
              <span className="font-sans text-sm font-medium">
                Initialize New Canvas
              </span>
            </button>
          </div>

          <div className="w-full">
            <h3 className="font-sans text-sm font-medium border-b border-card-border pb-3 mb-4 text-foreground">
              Recent Workspaces
            </h3>
            <div className="flex flex-col gap-2">
              {recentThreads && recentThreads.length > 0 ? (
                recentThreads.slice(0, 5).map((thread) => (
                  <div
                    key={thread.id}
                    onClick={() => router.push(getThreadRoute(thread))}
                    className="group flex items-center justify-between p-3 hover:bg-tertiary/5 cursor-pointer rounded-sm transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <FileText className="w-4 h-4 text-tertiary/40" />
                      <span className="font-sans text-sm text-foreground">
                        {thread.title || "New Chat"}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-tertiary/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatRelativeTime(thread.lastMessageAt)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="font-mono text-xs text-tertiary/40 py-2">
                  No recent workspaces.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-end px-6 pb-6 pt-12 bg-gradient-to-t from-background via-background/80 to-transparent">
        <div className="pointer-events-auto w-full max-w-3xl lg:max-w-4xl">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            placeholder={
              selectedAgents.length >= 2
                ? `Message ${selectedAgents.map((a) => a.name).join(" & ")}...`
                : selectedAgents.length === 1
                  ? `Message ${selectedAgents[0].name}...`
                  : selectedAgent
                    ? `Message ${selectedAgent.name}...`
                    : "Instruct agent or query canvas..."
            }
            contextKey="new-chat"
            model={{
              selectedModel,
              onModelChange: setSelectedModel,
              showModelSelector: !isArenaMode,
              arenaSelector: <ArenaModelSelector disabled={isLoading} />,
            }}
            webSearch={{
              enabled: isWebSearchEnabled,
              onChange: setIsWebSearchEnabled,
            }}
            deepResearch={{
              enabled: isDeepResearchEnabled,
              onChange: setIsDeepResearchEnabled,
              depth: deepResearchDepth,
              onDepthChange: setDeepResearchDepth,
            }}
            {...(modelSupportsReasoning
              ? {
                  reasoning: {
                    effort: reasoningEffort,
                    onChange: setReasoningEffort,
                  },
                }
              : {})}
            agentSelection={{
              selected: selectedAgent,
              onChange: setSelectedAgent,
              selectedMany: selectedAgents,
              onChangeMany: setSelectedAgents,
            }}
          />
        </div>
      </div>
    </div>
  );
}
