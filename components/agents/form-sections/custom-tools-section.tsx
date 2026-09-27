"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, X, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomTool } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ToolToggle } from "./tool-toggle";

interface CustomToolsSectionProps {
  tools: string[];
  setTools: (tools: string[]) => void;
  search: string;
  setSearch: (value: string) => void;
  customTools: CustomTool[];
  isLoading: boolean;
}

function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getSelectionAliases(tool: CustomTool): string[] {
  return [
    `custom:${tool.id}`,
    `custom:${tool.name}`,
    tool.id,
    tool.name,
    toSnakeCase(tool.name),
  ];
}

export function CustomToolsSection({
  tools,
  setTools,
  search,
  setSearch,
  customTools,
  isLoading,
}: CustomToolsSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const enabledCustomTools = customTools.filter((tool) => tool.enabled);
  const filteredTools = enabledCustomTools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(search.toLowerCase()) ||
      tool.description.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedCount = enabledCustomTools.filter((tool) =>
    getSelectionAliases(tool).some((alias) => tools.includes(alias)),
  ).length;
  const hasSearch = search.trim().length > 0;
  const visibleTools =
    showAll || hasSearch ? filteredTools : filteredTools.slice(0, 8);

  return (
    <section id="agent-custom-tools" className="space-y-5 scroll-mt-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
          <Wrench className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Custom Tools
            </h2>
            {selectedCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-primary/8 text-primary text-[11px] font-semibold tabular-nums">
                {selectedCount} selected
              </span>
            )}
          </div>
          <p className="text-[13px] text-foreground/50 leading-relaxed mt-1">
            Add your own JavaScript tools to this agent.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-input-border bg-card-bg/50 p-4 md:p-5">
        {isLoading ? (
          <div className="text-center py-10">
            <p className="text-sm text-foreground/35 font-medium">
              Loading custom tools...
            </p>
          </div>
        ) : enabledCustomTools.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <div className="w-12 h-12 bg-hover-bg rounded-full flex items-center justify-center mx-auto">
              <Wrench className="h-5 w-5 text-foreground/30" />
            </div>
            <p className="text-sm text-foreground/45 font-medium">
              No enabled custom tools found.
            </p>
            <Button asChild variant="outline" className="rounded-lg">
              <Link href="/tools/new">Create Tool</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/30" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search custom tools..."
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

            <div className="space-y-1">
              {visibleTools.map((tool) => {
                const aliases = getSelectionAliases(tool);
                const uniqueId = `custom:${tool.id}`;
                const isSelected = aliases.some((alias) =>
                  tools.includes(alias),
                );
                const toggleSelection = () => {
                  if (isSelected) {
                    setTools(tools.filter((t) => !aliases.includes(t)));
                  } else {
                    setTools([
                      ...tools.filter((t) => !aliases.includes(t)),
                      uniqueId,
                    ]);
                  }
                };

                return (
                  <div
                    key={tool.id}
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
                          setTools([
                            ...tools.filter((t) => !aliases.includes(t)),
                            uniqueId,
                          ]);
                        } else {
                          setTools(tools.filter((t) => !aliases.includes(t)));
                        }
                      }}
                      ariaLabel={`Toggle ${tool.name}`}
                    />
                  </div>
                );
              })}
            </div>

            {!hasSearch && filteredTools.length > 8 && (
              <div className="pt-2 mt-1 border-t border-input-border">
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  {showAll
                    ? "Show fewer tools"
                    : `Show ${filteredTools.length - 8} more tools`}
                </button>
              </div>
            )}

            {filteredTools.length === 0 && search && (
              <div className="text-center py-8">
                <p className="text-sm text-foreground/35 font-medium">
                  No custom tools match &quot;{search}&quot;
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
