"use client";

import { useState } from "react";
import { Search, X, Loader2, Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolToggle } from "./tool-toggle";

interface Server {
  id: string;
  name: string;
}

interface Tool {
  name: string;
  description: string;
}

interface McpToolsSectionProps {
  tools: string[];
  setTools: (tools: string[]) => void;
  search: string;
  setSearch: (value: string) => void;
  servers: Server[];
  mcpTools: Record<string, Tool[]>;
  isLoading: boolean;
}

export function McpToolsSection({
  tools,
  setTools,
  search,
  setSearch,
  servers,
  mcpTools,
  isLoading,
}: McpToolsSectionProps) {
  const [expandedServers, setExpandedServers] = useState<
    Record<string, boolean>
  >({});
  const selectedMcpCount = tools.filter(
    (t) => !t.startsWith("default:") && !t.startsWith("custom:"),
  ).length;

  return (
    <section id="agent-mcp-tools" className="space-y-5 scroll-mt-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
          <Layout className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Connectors
            </h2>
            {selectedMcpCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-primary/8 text-primary text-[11px] font-semibold tabular-nums">
                {selectedMcpCount} selected
              </span>
            )}
          </div>
          <p className="text-[13px] text-foreground/50 leading-relaxed mt-1">
            Connect to external tools and services via connectors for specialized capabilities.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-input-border bg-card-bg/50 p-4 md:p-5">
        {isLoading ? (
          <div className="flex flex-col items-center py-10 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-foreground/35 font-medium uppercase tracking-wider">
              Initializing Connectors
            </p>
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 bg-hover-bg rounded-full flex items-center justify-center mx-auto mb-3">
              <Layout className="h-5 w-5 text-foreground/30" />
            </div>
            <p className="text-sm text-foreground/45 font-medium">
              No active connectors found.
            </p>
          </div>
        ) : (
          <>
            {/* Search Bar */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/30" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search connector tools..."
                className="w-full pl-9 pr-9 py-2 rounded-lg border border-input-border bg-input-bg text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-foreground placeholder:text-foreground/25"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-hover-bg transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-foreground/40" />
                </button>
              )}
            </div>

            {/* Tools List */}
            <div className="space-y-4">
              {servers.map((server) => {
                const serverTools = (mcpTools[server.id] || []).filter(
                  (tool) =>
                    tool.name
                      .toLowerCase()
                      .includes(search.toLowerCase()) ||
                    tool.description
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                );
                if (serverTools.length === 0) return null;
                const hasSearch = search.trim().length > 0;
                const isExpanded = expandedServers[server.id] || false;
                const visibleTools =
                  hasSearch || isExpanded
                    ? serverTools
                    : serverTools.slice(0, 5);

                return (
                  <div key={server.id} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px] font-semibold text-foreground/40 uppercase tracking-wider px-1 py-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                      {server.name}
                      <span className="ml-auto text-foreground/25 tabular-nums">
                        {serverTools.length} tools
                      </span>
                    </div>
                    <div className="space-y-1">
                      {visibleTools.map((tool) => {
                        const uniqueId = `${server.name}:${tool.name}`;
                        const isSelected = tools.includes(uniqueId);
                        const toggleSelection = () => {
                          if (isSelected) {
                            setTools(tools.filter((t) => t !== uniqueId));
                          } else {
                            setTools([...tools, uniqueId]);
                          }
                        };
                        return (
                          <div
                            key={tool.name}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            onClick={toggleSelection}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              toggleSelection();
                            }}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                              isSelected
                                ? "bg-primary/6 border-primary/25 hover:bg-primary/10"
                                : "bg-transparent border-transparent hover:bg-hover-bg hover:border-input-border",
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {tool.name}
                              </p>
                              <p className="text-xs text-foreground/45 truncate">
                                {tool.description}
                              </p>
                            </div>
                            <ToolToggle
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setTools([...tools, uniqueId]);
                                } else {
                                  setTools(
                                    tools.filter((t) => t !== uniqueId),
                                  );
                                }
                              }}
                              ariaLabel={`Toggle ${tool.name}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {!hasSearch && serverTools.length > 5 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedServers((prev) => ({
                            ...prev,
                            [server.id]: !isExpanded,
                          }))
                        }
                        className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-1"
                      >
                        {isExpanded
                          ? `Show fewer from ${server.name}`
                          : `Show ${serverTools.length - 5} more from ${server.name}`}
                      </button>
                    )}
                  </div>
                );
              })}
              {servers.every((server) => {
                const serverTools = (mcpTools[server.id] || []).filter(
                  (tool) =>
                    tool.name
                      .toLowerCase()
                      .includes(search.toLowerCase()) ||
                    tool.description
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                );
                return serverTools.length === 0;
              }) &&
                search && (
                  <div className="text-center py-8">
                    <p className="text-sm text-foreground/35 font-medium">
                      No connector tools match &quot;{search}&quot;
                    </p>
                  </div>
                )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
