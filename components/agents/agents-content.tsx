"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Plus,
  AlertCircle,
  Loader2,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  useAgents,
  useDeleteAgent,
  useToggleFavoriteAgent,
  useToggleActiveAgent,
} from "@/hooks/use-agents-queries";
import { useApiKeys } from "@/hooks/use-api-keys-queries";
import { useWorkflows } from "@/hooks/use-workflows-queries";
import { useDebounce } from "@/hooks/use-debounce";
import { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentCard } from "@/components/agents/agent-card";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import {
  BackgroundUploadJob,
  dismissBackgroundUploadJob,
  getUploadJobsUpdatedEventName,
  pruneBackgroundUploadJobs,
  readBackgroundUploadJobs,
} from "@/lib/agent-upload-status";

import { ContentLayout } from "@/components/common/content-layout";

interface AgentsContentProps {
  initialAgents?: Agent[];
}

type AgentTab = "favorites" | "all" | "active" | "multiAgent" | "disabled";

export function AgentsContent({ initialAgents }: AgentsContentProps) {
  const router = useRouter();

  // Server state from React Query
  const {
    data: agents = initialAgents ?? [],
    isLoading,
    error,
  } = useAgents(initialAgents);
  const { data: apiKeys = [] } = useApiKeys();
  const { data: workflows = [] } = useWorkflows();
  const deleteAgentMutation = useDeleteAgent();
  const toggleFavoriteMutation = useToggleFavoriteAgent();
  const toggleActiveMutation = useToggleActiveAgent();

  // UI State
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [activeTab, setActiveTab] = useState<AgentTab>("all");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundUploadJob[]>(
    [],
  );

  useEffect(() => {
    const refreshJobs = () => {
      setBackgroundJobs(readBackgroundUploadJobs());
    };

    pruneBackgroundUploadJobs();
    refreshJobs();

    const onJobsUpdated = () => refreshJobs();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "agent-background-upload-jobs") {
        refreshJobs();
      }
    };

    const eventName = getUploadJobsUpdatedEventName();
    window.addEventListener(eventName, onJobsUpdated);
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(() => {
      pruneBackgroundUploadJobs();
    }, 5000);

    return () => {
      window.removeEventListener(eventName, onJobsUpdated);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  const handleEditAgent = (agent: Agent) => {
    router.push(`/agents/${agent.id}/edit`);
  };

  const handleCreateNew = () => {
    router.push("/agents/new");
  };

  const handleDeleteAgent = async (agentId: string) => {
    await deleteAgentMutation.mutateAsync(agentId);
    setShowDeleteConfirm(null);
  };

  const handleChat = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent?.subAgents && agent.subAgents.length > 0) {
      router.push(`/multi-agent-chat/${agentId}`);
    } else {
      router.push(`/agent-chat/${agentId}`);
    }
  };

  const tabFilteredAgents = agents.filter((agent) => {
    if (activeTab === "active") return agent.active;
    if (activeTab === "disabled") return !agent.active;
    if (activeTab === "multiAgent")
      return !!agent.subAgents && agent.subAgents.length > 0;
    if (activeTab === "favorites") return !!agent.isFavorite;
    return true;
  });

  const filteredAgents = tabFilteredAgents.filter((agent) => {
    const query = debouncedSearchQuery.toLowerCase();
    return (
      agent.name.toLowerCase().includes(query) ||
      agent.description.toLowerCase().includes(query)
    );
  });

  const activeCount = agents.filter((agent) => agent.active).length;
  const disabledCount = agents.filter((agent) => !agent.active).length;
  const favoriteCount = agents.filter((agent) => !!agent.isFavorite).length;
  const multiAgentCount = agents.filter(
    (agent) => !!agent.subAgents && agent.subAgents.length > 0,
  ).length;

  const tabs: { key: AgentTab; label: string; count?: number }[] = [
    { key: "favorites", label: "Favorites", count: favoriteCount },
    { key: "all", label: "All Agents", count: agents.length },
    { key: "active", label: "Active", count: activeCount },
    { key: "multiAgent", label: "Multi Agent", count: multiAgentCount },
    { key: "disabled", label: "Disabled", count: disabledCount },
  ];

  return (
    <ContentLayout
      title="Agent Fleet"
      description="Manage autonomous workers and customized models."
      searchPlaceholder="Search agents..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      actionButton={
        <button
          onClick={handleCreateNew}
          className="bg-primary text-background px-4 py-2 text-sm font-medium rounded-sm hover:opacity-80 transition-opacity flex items-center gap-2 cursor-pointer h-10"
        >
          <Plus className="w-4 h-4" /> Create Agent
        </button>
      }
      navigation={
        <div className="w-full overflow-x-auto hide-scrollbar">
          <div className="flex min-w-max items-center gap-6 whitespace-nowrap py-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "font-mono text-[10px] uppercase tracking-widest pb-2 transition-colors cursor-pointer",
                  activeTab === tab.key
                    ? "text-foreground border-b border-foreground"
                    : "text-tertiary/40 hover:text-foreground",
                )}
              >
                {tab.label}
                {typeof tab.count === "number" ? ` (${tab.count})` : ""}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {/* Background Upload/Indexing Status */}
      {backgroundJobs.length > 0 && (
        <div className="mb-4 space-y-2">
          {backgroundJobs.map((job) => {
            const total = job.files.length;
            const completed = job.files.filter(
              (file) => file.status === "completed",
            ).length;
            const failed = job.files.filter(
              (file) => file.status === "failed",
            ).length;
            const processing = job.files.filter(
              (file) => file.status === "processing",
            ).length;
            const pending = job.files.filter(
              (file) => file.status === "pending",
            ).length;
            const isDone = completed + failed === total;

            return (
              <div
                key={job.id}
                className="rounded-lg border border-card-border bg-card-bg/60 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  {isDone ? (
                    failed > 0 ? (
                      <AlertCircle className="mt-0.5 h-5 w-5 text-[var(--amber)] shrink-0" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--green)] shrink-0" />
                    )
                  ) : (
                    <Loader2 className="mt-0.5 h-5 w-5 text-primary animate-spin shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {isDone
                        ? failed > 0
                          ? `Indexing completed with errors for ${job.agentName}`
                          : `Indexing completed for ${job.agentName}`
                        : `Indexing documents for ${job.agentName}`}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {completed}/{total} completed
                      {failed > 0 && `, ${failed} failed`}
                      {!isDone &&
                        `, ${processing + pending} remaining (${processing} active)`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      dismissBackgroundUploadJob(job.id);
                      setBackgroundJobs((prev) =>
                        prev.filter((item) => item.id !== job.id),
                      );
                    }}
                    className="rounded-md p-1 text-text-secondary hover:text-foreground hover:bg-secondary transition-colors"
                    aria-label="Dismiss upload status"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Loading State */}
      {isLoading && agents.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="rounded-md border border-card-border bg-card-bg p-4 animate-pulse"
            >
              <div className="mb-2 h-4 w-2/3 rounded bg-hover-bg" />
              <div className="mb-1.5 h-3 w-full rounded bg-hover-bg" />
              <div className="mb-4 h-3 w-5/6 rounded bg-hover-bg" />
              <div className="h-8 w-full rounded border border-card-border bg-secondary/50" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          <span>
            {error instanceof Error ? error.message : "Failed to load agents"}
          </span>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
          <h3 className="text-base font-semibold text-foreground">
            {activeTab === "favorites" && !searchQuery
              ? "No favorite agents yet"
              : activeTab === "active" && !searchQuery
                ? "No active agents yet"
                : activeTab === "multiAgent" && !searchQuery
                  ? "No multi agent setups yet"
                  : activeTab === "disabled" && !searchQuery
                    ? "No disabled agents yet"
                : "No agents found"}
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery
              ? "Try a different search keyword."
              : activeTab === "favorites"
                ? "Click the heart icon on any agent to add it to Favorites."
                : activeTab === "multiAgent"
                  ? "Create an agent and add sub-agents to enable multi-agent chat."
                  : activeTab === "disabled"
                    ? "Disabled agents appear here when you turn them off."
                : "Create a new agent to get started."}
          </p>
          {!searchQuery && activeTab !== "favorites" && (
            <Button
              onClick={handleCreateNew}
              className="mt-4 h-9 rounded-md px-4 shadow-none hover:scale-100"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Agent
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent: Agent, i: number) => {
            const isUsedInOtherAgent = agents.some((a) =>
              a.subAgents?.some((sa) => sa.id === agent.id),
            );
            const isUsedInApiKey = apiKeys.some(
              (k) => !k.revoked && k.scopes?.includes(agent.id),
            );
            const isUsedInWorkflow = workflows.some((w) =>
              w.steps?.some((step) => step.agentId === agent.id),
            );

            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={i}
                onChat={handleChat}
                onEdit={handleEditAgent}
                onDelete={(id) => setShowDeleteConfirm(id)}
                isFavorite={!!agent.isFavorite}
                onFavoriteToggle={(e) => {
                  e.stopPropagation();
                  toggleFavoriteMutation.mutate({
                    agentId: agent.id,
                    favorite: !agent.isFavorite,
                  });
                }}
                onToggleActive={(e) => {
                  e.stopPropagation();
                  toggleActiveMutation.mutate({
                    agentId: agent.id,
                    active: !agent.active,
                  });
                }}
                isUsedInOtherAgent={isUsedInOtherAgent}
                isUsedInApiKey={isUsedInApiKey}
                isUsedInWorkflow={isUsedInWorkflow}
              />
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() =>
          showDeleteConfirm && handleDeleteAgent(showDeleteConfirm)
        }
        isDeleting={deleteAgentMutation.isPending}
        title="Delete Agent"
        description="Are you sure you want to delete this agent? This action cannot be undone."
      />
    </ContentLayout>

  );
}
