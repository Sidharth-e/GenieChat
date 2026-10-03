"use client";

import * as React from "react";
import { ChevronDown, Server, Wrench } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMCPStore, type MCPToolInfo } from "@/lib/stores";
import {
  DEFAULT_TOOLS_METADATA,
  RESOLVABLE_DEFAULT_TOOLS,
} from "@/lib/tool/default-tools-metadata";
import type { WorkflowToolKey } from "@/lib/workflow/types";

interface ToolPickerProps {
  value?: WorkflowToolKey;
  onChange: (key: WorkflowToolKey) => void;
}

export function ToolPicker({ value, onChange }: ToolPickerProps) {
  const { servers, tools, fetchServers, fetchTools } = useMCPStore();

  React.useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  const enabledServers = servers.filter((server) => server.enabled);

  const pickAppTool = (id: string, description: string) =>
    onChange({ id, description, type: "app-tool" });

  const pickMCPTool = (serverId: string, serverName: string, tool: MCPToolInfo) =>
    onChange({
      id: tool.name,
      description: tool.description,
      type: "mcp-tool",
      serverId,
      serverName,
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-secondary"
        >
          <span className="truncate">{value ? value.id : "Select a tool"}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72 max-h-80 overflow-y-auto bg-secondary border-card-border"
      >
        <DropdownMenuLabel>App tools</DropdownMenuLabel>
        {DEFAULT_TOOLS_METADATA.filter((tool) =>
          RESOLVABLE_DEFAULT_TOOLS.includes(tool.name),
        ).map((tool) => (
          <DropdownMenuItem
            key={tool.name}
            onSelect={() => pickAppTool(tool.name, tool.description)}
            className="flex items-start gap-2 py-2"
          >
            <Wrench className="size-3.5 mt-0.5 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{tool.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                {tool.description}
              </span>
            </div>
          </DropdownMenuItem>
        ))}

        {enabledServers.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>MCP tools</DropdownMenuLabel>
            {enabledServers.map((server) => {
              const serverTools = tools[server.id] ?? [];
              return (
                <DropdownMenuSub key={server.id}>
                  <DropdownMenuSubTrigger
                    onPointerEnter={() => {
                      // Discover lazily — the picker is opened far more often
                      // than a server's tools are actually wanted.
                      if (!tools[server.id]) void fetchTools(server.id);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Server className="size-3.5" />
                    {server.name}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                    {serverTools.length === 0 ? (
                      <DropdownMenuItem disabled>
                        No tools discovered
                      </DropdownMenuItem>
                    ) : (
                      serverTools.map((tool) => (
                        <DropdownMenuItem
                          key={tool.name}
                          onSelect={() => pickMCPTool(server.id, server.name, tool)}
                        >
                          {tool.name}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
