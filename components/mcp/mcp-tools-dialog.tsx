"use client";

import React, { useState, useMemo } from "react";
import {
  Power,
  RefreshCw,
  Wrench,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Globe,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MCPServerConfig } from "@/lib/types";
import { transportIcons } from "./server-card";

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPToolsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  server: MCPServerConfig | null;
  tools: MCPTool[];
  isLoadingTools: boolean;
  toolsError: string | null;
  onRefresh: (serverId: string) => void;
  onToggle: (server: MCPServerConfig) => void;
}

export function MCPToolsDialog({
  isOpen,
  onClose,
  server,
  tools,
  isLoadingTools,
  toolsError,
  onRefresh,
  onToggle,
}: MCPToolsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const [schemaViewMode, setSchemaViewMode] = useState<Record<string, "params" | "raw">>({});
  const [copiedTool, setCopiedTool] = useState<string | null>(null);

  const Icon = server ? transportIcons[server.transportType] || Globe : Globe;

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        (tool.description && tool.description.toLowerCase().includes(q)),
    );
  }, [tools, searchQuery]);

  const toggleSchema = (toolName: string) => {
    setExpandedSchemas((prev) => ({
      ...prev,
      [toolName]: !prev[toolName],
    }));
  };

  const handleCopy = async (toolName: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTool(toolName);
      setTimeout(() => setCopiedTool(null), 1800);
    } catch {
      // Fallback
    }
  };

  if (!server) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] flex flex-col p-0 overflow-hidden bg-card-bg border border-card-border shadow-2xl rounded-lg">
        <DialogHeader className="p-5 pb-4 border-b border-card-border bg-tertiary/5 space-y-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-md bg-tertiary/10 border border-card-border flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-base font-medium text-foreground tracking-tight truncate">
                    {server.name}
                  </DialogTitle>
                  <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded border border-card-border bg-tertiary/10 text-tertiary/70 font-semibold tracking-wider">
                    {server.transportType}
                  </span>
                </div>
                <DialogDescription className="font-mono text-xs text-tertiary/60 truncate mt-0.5">
                  {server.serverUrl || "mcp://local"}
                </DialogDescription>
                {server.description && server.description !== server.name && (
                  <p className="text-xs text-text-secondary mt-1 line-clamp-1">
                    {server.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-card-border bg-card-bg font-mono text-xs">
                {server.enabled ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
                    <span className="text-[var(--green)]">Connected</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[var(--red)]" />
                    <span className="text-[var(--red)]">Disabled</span>
                  </>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggle(server)}
                className="h-8 px-2.5 text-xs gap-1.5 border-card-border bg-card-bg hover:bg-tertiary/5 text-foreground cursor-pointer"
              >
                <Power className="h-3.5 w-3.5 text-tertiary/60" />
                <span>{server.enabled ? "Disable" : "Enable"}</span>
              </Button>

              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-md flex items-center justify-center text-tertiary/40 hover:text-foreground hover:bg-tertiary/5 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-3 border-b border-card-border bg-card-bg flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-tertiary/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tools by name or description..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-tertiary/5 border border-card-border rounded-sm text-foreground placeholder:text-tertiary/40 focus:outline-none focus:border-tertiary/40 font-mono transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary/40 hover:text-foreground p-0.5 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-tertiary/60 tabular-nums">
              {searchQuery ? `${filteredTools.length} of ${tools.length}` : `${tools.length}`}{" "}
              {tools.length === 1 ? "tool" : "tools"}
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRefresh(server.id)}
              disabled={isLoadingTools || !server.enabled}
              className="h-8 px-2 text-xs font-mono gap-1 text-tertiary/60 hover:text-foreground hover:bg-tertiary/5 cursor-pointer"
            >
              <RefreshCw className={cn("h-3 w-3", isLoadingTools && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {!server.enabled ? (
            <div className="py-12 px-4 text-center border border-dashed border-card-border rounded-sm bg-tertiary/5 space-y-3">
              <div className="h-10 w-10 rounded-full bg-tertiary/10 text-tertiary/50 mx-auto flex items-center justify-center">
                <Power className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">Connector is disabled</h4>
                <p className="text-xs text-text-secondary max-w-sm mx-auto">
                  Enable this connector to view, inspect, and use its available tools in your agents.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggle(server)}
                className="h-8 text-xs px-3 border-card-border bg-card-bg hover:bg-tertiary/10 cursor-pointer text-foreground"
              >
                Enable connector
              </Button>
            </div>
          ) : isLoadingTools && tools.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="p-4 border border-card-border rounded-sm bg-card-bg animate-pulse space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-40 bg-hover-bg rounded" />
                    <div className="h-3 w-16 bg-hover-bg rounded" />
                  </div>
                  <div className="h-3 w-3/4 bg-hover-bg rounded" />
                  <div className="h-3 w-1/2 bg-hover-bg rounded" />
                </div>
              ))}
            </div>
          ) : toolsError && tools.length === 0 ? (
            <div className="p-4 rounded-sm border border-[var(--red-border)] bg-[var(--red-bg)] text-[var(--red)] space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Failed to load tools from connector</span>
              </div>
              <p className="text-xs opacity-80 font-mono break-all">{toolsError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRefresh(server.id)}
                className="h-7 text-xs border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-bg)] cursor-pointer mt-1"
              >
                Try again
              </Button>
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="py-12 px-4 text-center border border-dashed border-card-border rounded-sm bg-tertiary/5 space-y-2">
              <div className="h-9 w-9 rounded-full bg-tertiary/10 text-tertiary/50 mx-auto flex items-center justify-center">
                <Wrench className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-medium text-foreground">
                {searchQuery ? "No matching tools found" : "No tools exported"}
              </h4>
              <p className="text-xs text-text-secondary max-w-sm mx-auto">
                {searchQuery
                  ? `No tools match "${searchQuery}". Try a different keyword.`
                  : "This connector currently does not expose any tools."}
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery("")}
                  className="h-7 text-xs font-mono text-tertiary/60 hover:text-foreground cursor-pointer"
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            filteredTools.map((tool) => {
              const isExpanded = expandedSchemas[tool.name] || false;
              const mode = schemaViewMode[tool.name] || "params";
              const schema = tool.inputSchema as Record<string, unknown> | undefined;
              const properties = (schema?.properties as Record<string, unknown>) || {};
              const requiredFields = Array.isArray(schema?.required)
                ? (schema.required as string[])
                : [];
              const propKeys = Object.keys(properties);

              return (
                <div
                  key={tool.name}
                  className="border border-card-border bg-card-bg hover:border-tertiary/30 rounded-sm transition-colors overflow-hidden"
                >
                  <div className="p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Wrench className="h-3.5 w-3.5 text-tertiary/50 shrink-0" />
                        <span className="font-mono text-xs font-semibold text-foreground tracking-tight select-all truncate">
                          {tool.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-[10px] text-tertiary/50 px-1.5 py-0.5 rounded bg-tertiary/5 border border-card-border">
                          {propKeys.length} {propKeys.length === 1 ? "param" : "params"}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleCopy(tool.name, tool.name)}
                          className="h-6 w-6 rounded flex items-center justify-center text-tertiary/40 hover:text-foreground hover:bg-tertiary/5 transition-colors cursor-pointer"
                          title="Copy tool name"
                        >
                          {copiedTool === tool.name ? (
                            <Check className="h-3 w-3 text-[var(--green)]" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {tool.description && (
                      <p className="text-xs text-text-secondary leading-relaxed font-sans">
                        {tool.description}
                      </p>
                    )}

                    {schema && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => toggleSchema(tool.name)}
                          className="font-mono text-[11px] text-tertiary/50 hover:text-foreground inline-flex items-center gap-1.5 select-none transition-colors cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          <span>{isExpanded ? "Hide schema" : "View schema"}</span>
                        </button>

                        {isExpanded && (
                          <div className="mt-2.5 rounded-sm border border-card-border bg-tertiary/5 p-3 space-y-2.5">
                            <div className="flex items-center justify-between border-b border-card-border pb-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSchemaViewMode((prev) => ({
                                      ...prev,
                                      [tool.name]: "params",
                                    }))
                                  }
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer",
                                    mode === "params"
                                      ? "bg-primary text-background font-medium"
                                      : "text-tertiary/50 hover:text-foreground",
                                  )}
                                >
                                  Parameters
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSchemaViewMode((prev) => ({
                                      ...prev,
                                      [tool.name]: "raw",
                                    }))
                                  }
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer",
                                    mode === "raw"
                                      ? "bg-primary text-background font-medium"
                                      : "text-tertiary/50 hover:text-foreground",
                                  )}
                                >
                                  JSON Schema
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(
                                    `schema-${tool.name}`,
                                    JSON.stringify(schema, null, 2),
                                  )
                                }
                                className="h-5 px-1.5 rounded flex items-center gap-1 text-[10px] font-mono text-tertiary/50 hover:text-foreground hover:bg-tertiary/10 transition-colors cursor-pointer"
                                title="Copy schema JSON"
                              >
                                {copiedTool === `schema-${tool.name}` ? (
                                  <>
                                    <Check className="h-2.5 w-2.5 text-[var(--green)]" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-2.5 w-2.5" />
                                    <span>Copy JSON</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {mode === "params" ? (
                              propKeys.length === 0 ? (
                                <p className="text-[11px] text-tertiary/40 font-mono py-1">
                                  No input parameters defined.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {propKeys.map((propKey) => {
                                    const propVal = (properties[propKey] as Record<
                                      string,
                                      unknown
                                    >) || {};
                                    const isReq = requiredFields.includes(propKey);
                                    const propType = (propVal.type as string) || "any";
                                    const propDesc = (propVal.description as string) || "";

                                    return (
                                      <div
                                        key={propKey}
                                        className="p-2 rounded bg-card-bg border border-card-border/60 text-xs space-y-1"
                                      >
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <code className="font-mono text-xs font-semibold text-foreground">
                                            {propKey}
                                          </code>
                                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-tertiary/10 text-tertiary/70 border border-card-border">
                                            {propType}
                                          </span>
                                          {isReq && (
                                            <span className="font-mono text-[10px] text-[var(--red)] font-semibold">
                                              required
                                            </span>
                                          )}
                                        </div>
                                        {propDesc && (
                                          <p className="text-[11px] text-text-secondary leading-snug">
                                            {propDesc}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )
                            ) : (
                              <pre className="p-2.5 rounded bg-card-bg border border-card-border overflow-x-auto text-[11px] font-mono text-tertiary/80 leading-relaxed max-h-56">
                                {JSON.stringify(schema, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-card-border bg-tertiary/5 flex items-center justify-between gap-4">
          <div className="font-mono text-[11px] text-tertiary/50 truncate">
            {server.name} • {server.serverUrl || "mcp://local"}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 px-4 text-xs font-medium border-card-border bg-card-bg hover:bg-tertiary/5 text-foreground cursor-pointer"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
