
import React from "react";
import { Loader2, Power, RefreshCw, Wrench } from "lucide-react";
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

interface MCPTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

interface ServerToolsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    server: MCPServerConfig | null;
    tools: MCPTool[];
    isLoadingTools: boolean;
    toolsError: string | null;
    onRefresh: (serverId: string) => void;
    onToggle: (server: MCPServerConfig) => void;
}

export function ServerToolsDialog({
    isOpen,
    onClose,
    server,
    tools,
    isLoadingTools,
    toolsError,
    onRefresh,
    onToggle,
}: ServerToolsDialogProps) {
    if (!server) return null;
    const Icon = transportIcons[server.transportType] || Wrench;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-2">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "rounded-lg p-2 flex items-center justify-center",
                            server?.enabled
                                ? "bg-primary/10 text-primary"
                                : "bg-hover-bg text-text-secondary"
                        )}>
                            <Icon className="h-5 w-5" />
                        </div>
                        <div>
                            <DialogTitle>{server?.name}</DialogTitle>
                            <DialogDescription className="mt-1">
                                {server?.description || "No description provided"}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
                    <div className="space-y-6">
                        {/* Stats & Controls */}
                        <div className="flex items-center justify-between rounded-lg bg-secondary p-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium text-text-secondary">Status</div>
                                <div className={cn(
                                    "inline-flex items-center gap-2 text-sm font-semibold",
                                    server?.enabled ? "text-primary" : "text-text-secondary"
                                )}>
                                    <div className={cn("h-2 w-2 rounded-full", server?.enabled ? "bg-primary" : "bg-text-secondary")} />
                                    {server?.enabled ? "Active" : "Disabled"}
                                </div>
                            </div>
                            <Button
                                variant={server?.enabled ? "outline" : "default"}
                                size="sm"
                                onClick={() => server && onToggle(server)}
                            >
                                <Power className="mr-2 h-4 w-4" />
                                {server?.enabled ? "Disable" : "Enable"}
                            </Button>
                        </div>

                        {/* Tools List */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-medium text-text-secondary">
                                    Available Tools ({tools.length})
                                </h3>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => server && onRefresh(server.id)}
                                    disabled={isLoadingTools || !server?.enabled}
                                >
                                    {isLoadingTools ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                    <span className="ml-1">Refresh</span>
                                </Button>
                            </div>

                            {!server?.enabled ? (
                                <p className="text-sm text-text-secondary">
                                    Enable the server to fetch available tools.
                                </p>
                            ) : isLoadingTools && tools.length === 0 ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
                                    <span className="ml-2 text-sm text-text-secondary">Loading tools...</span>
                                </div>
                            ) : toolsError && tools.length === 0 ? (
                                <div className="rounded-lg bg-red-50 p-3 dark:bg-red-500/10">
                                    <p className="text-sm text-red-600 dark:text-red-400">{toolsError}</p>
                                </div>
                            ) : (tools.length === 0) ? (
                                <p className="text-sm text-text-secondary">
                                    Click &quot;Refresh&quot; to load available tools from this server.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {tools.map((tool) => (
                                        <div
                                            key={tool.name}
                                            className="group relative rounded-lg border border-card-border bg-card-bg p-4 transition-all hover:border-primary/50 hover:shadow-sm"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                    <Wrench className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h4 className="font-semibold text-sm text-foreground font-mono">
                                                            {tool.name}
                                                        </h4>
                                                    </div>
                                                    {tool.description && (
                                                        <p className="mt-1 text-sm text-text-secondary">
                                                            {tool.description}
                                                        </p>
                                                    )}
                                                    {tool.inputSchema && (
                                                        <details className="mt-2 text-xs">
                                                            <summary className="cursor-pointer font-medium text-text-secondary hover:text-foreground">
                                                                View Schema
                                                            </summary>
                                                            <pre className="mt-2 w-full overflow-x-auto rounded bg-secondary p-2 text-text-secondary">
                                                                {JSON.stringify(tool.inputSchema, null, 2)}
                                                            </pre>
                                                        </details>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
