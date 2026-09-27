"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Pen,
  Trash2,
  Users,
  ExternalLink,
  Heart,
  Power,
  PowerOff,
  Network,
  EllipsisVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Agent } from "@/lib/types";
import { ApiKeyDialog } from "./api-key-dialog";

export interface AgentCardProps {
  agent: Agent;
  index?: number;
  onChat: (id: string) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (id: string) => void;
  isFavorite: boolean;
  onFavoriteToggle: (e: React.MouseEvent) => void;
  onToggleActive: (e: React.MouseEvent) => void;
  isUsedInOtherAgent?: boolean;
  isUsedInApiKey?: boolean;
  isUsedInWorkflow?: boolean;
}

export function AgentCard({
  agent,
  index = 0,
  onChat,
  onEdit,
  onDelete,
  isFavorite,
  onFavoriteToggle,
  onToggleActive,
  isUsedInOtherAgent,
  isUsedInApiKey,
  isUsedInWorkflow,
}: AgentCardProps) {
  const [apiDialogOpen, setApiDialogOpen] = useState(false);

  const cannotDelete = isUsedInOtherAgent || isUsedInApiKey || isUsedInWorkflow;
  const deleteTooltip = isUsedInWorkflow
    ? "Used in a workflow"
    : isUsedInOtherAgent
      ? "Used as a sub-agent"
      : isUsedInApiKey
        ? "Has active API key"
        : "";

  const cannotDisable = isUsedInOtherAgent && agent.active;
  const isOrchestrator = (agent.subAgents?.length ?? 0) > 0;

  const tools = agent.tools || [];
  const visibleTools = tools.slice(0, 3);
  const overflowCount = tools.length - visibleTools.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.04,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (agent.active) onChat(agent.id);
        }
      }}
      onClick={() => {
        if (agent.active) onChat(agent.id);
      }}
      className={cn(
        "group relative flex h-full flex-col rounded-sm border border-card-border bg-card-bg p-6",
        "transition-colors duration-200 cursor-pointer hover:border-tertiary/40 overflow-hidden",
        !agent.active && "opacity-60 grayscale hover:grayscale-0 hover:opacity-100",
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-tertiary/5 rounded-sm text-foreground">
          {isOrchestrator ? (
            <Network className="w-5 h-5 text-foreground" />
          ) : (
            <Bot className="w-5 h-5 text-foreground" />
          )}
        </div>

        <div className="flex items-center gap-2">
          {agent.active ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--green)]">
              <span className="w-1.5 h-1.5 bg-[var(--green)] rounded-full animate-pulse" />{" "}
              Available
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-tertiary/40">
              <span className="w-1.5 h-1.5 bg-tertiary/40 rounded-full" /> Dormant
            </span>
          )}

          <button
            type="button"
            className="p-1 rounded-sm text-tertiary/40 hover:text-[var(--red)] transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onFavoriteToggle(e);
            }}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                isFavorite
                  ? "fill-[var(--red)] text-[var(--red)]"
                  : "text-tertiary/40 hover:text-[var(--red)]",
              )}
            />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-sm p-1 text-tertiary/40 transition-colors hover:text-foreground cursor-pointer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Agent options"
              >
                <EllipsisVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44 border-card-border bg-card-bg shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-xs"
                onClick={() => onEdit(agent)}
              >
                <Pen className="h-3.5 w-3.5 text-tertiary/60" />
                Edit agent
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-xs"
                onClick={() => setApiDialogOpen(true)}
              >
                <ExternalLink className="h-3.5 w-3.5 text-tertiary/60" />
                API access
              </DropdownMenuItem>
              <DropdownMenuItem
                className={cn(
                  "cursor-pointer gap-2 text-xs",
                  cannotDisable && "opacity-50",
                )}
                disabled={!!cannotDisable}
                onClick={(e) => {
                  if (!cannotDisable) onToggleActive(e);
                }}
              >
                {agent.active ? (
                  <PowerOff className="h-3.5 w-3.5 text-tertiary/60" />
                ) : (
                  <Power className="h-3.5 w-3.5 text-tertiary/60" />
                )}
                <div>
                  <div>{agent.active ? "Disable agent" : "Enable agent"}</div>
                  {cannotDisable && (
                    <div className="text-[10px] text-tertiary/40">
                      Used as a sub-agent
                    </div>
                  )}
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={cn(
                  "cursor-pointer gap-2 text-xs text-[var(--red)] focus:text-[var(--red)]",
                  cannotDelete && "opacity-50",
                )}
                disabled={!!cannotDelete}
                onClick={() => {
                  if (!cannotDelete) onDelete(agent.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <div>
                  <div>Delete agent</div>
                  {cannotDelete && (
                    <div className="text-[10px] text-tertiary/40">
                      {deleteTooltip}
                    </div>
                  )}
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-sans text-lg font-medium text-foreground truncate">
          {agent.name}
        </h3>
        {isOrchestrator && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-xs bg-tertiary/5 px-1.5 py-0.5 text-[9px] font-mono uppercase text-tertiary/60"
            title={`${agent.subAgents!.length} Sub-agent${agent.subAgents!.length > 1 ? "s" : ""}`}
          >
            <Users className="h-3 w-3" />
            {agent.subAgents!.length}
          </span>
        )}
      </div>

      <p className="font-sans text-sm text-text-secondary mb-6 line-clamp-2 leading-relaxed">
        {agent.description || "No description provided."}
      </p>

      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <span className="font-mono text-[9px] uppercase tracking-wider bg-tertiary/5 px-2 py-1 text-tertiary/50 rounded-xs">
          {agent.modelId?.replace("gemini-", "") || "default"}
        </span>
        {visibleTools.map((tool) => (
          <span
            key={tool}
            className="font-mono text-[9px] uppercase tracking-wider bg-tertiary/5 px-2 py-1 text-tertiary/50 rounded-xs"
          >
            {tool}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="font-mono text-[9px] uppercase tracking-wider bg-tertiary/5 px-2 py-1 text-tertiary/40 rounded-xs">
            +{overflowCount}
          </span>
        )}
      </div>

      <ApiKeyDialog
        agent={agent}
        isOpen={apiDialogOpen}
        onClose={() => setApiDialogOpen(false)}
      />
    </motion.div>
  );
}
