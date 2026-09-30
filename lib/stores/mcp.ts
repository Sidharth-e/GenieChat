"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MCPServerConfig } from "@/lib/types";

// Tool info from MCP servers
export interface MCPToolInfo {
    name: string;
    description: string;
    serverName: string;
    inputSchema?: Record<string, unknown>;
}

interface MCPState {
    servers: MCPServerConfig[];
    selectedServerId: string | null;
    isLoading: boolean;
    error: string | null;

    // Tools state
    tools: Record<string, MCPToolInfo[]>;
    loadingServerTools: Record<string, boolean>;
    isLoadingTools: boolean;
    toolsError: string | null;

    // Server Actions
    setServers: (servers: MCPServerConfig[]) => void;
    fetchServers: () => Promise<void>;
    createServer: (server: {
        name: string;
        description?: string;
        transportType: MCPServerConfig["transportType"];
        serverUrl?: string;
        headers?: Record<string, string>;
        timeout?: number;
        requireApproval?: MCPServerConfig["requireApproval"];
    }) => Promise<MCPServerConfig | null>;
    updateServer: (id: string, updates: Partial<MCPServerConfig>) => Promise<MCPServerConfig | null>;
    deleteServer: (id: string) => Promise<boolean>;
    toggleServer: (id: string) => Promise<MCPServerConfig | null>;
    setSelectedServer: (id: string | null) => void;

    // Tools Actions
    fetchTools: (serverId: string) => Promise<MCPToolInfo[]>;
    getToolsForServer: (serverId: string) => MCPToolInfo[];
    clearTools: (serverId?: string) => void;
}

export const useMCPStore = create<MCPState>()(
    persist(
        (set, get) => ({
            servers: [],
            selectedServerId: null,
            isLoading: false,
            error: null,

            tools: {},
            loadingServerTools: {},
            isLoadingTools: false,
            toolsError: null,

            setServers: (servers) => {
                set({
                    servers,
                    isLoading: false,
                    error: null,
                });
            },

            fetchServers: async () => {
                set({ isLoading: true, error: null });
                try {
                    const response = await fetch("/api/mcp");
                    if (!response.ok) {
                        throw new Error("Failed to fetch MCP servers");
                    }
                    const servers = await response.json();
                    set({
                        servers,
                        isLoading: false,
                    });
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : "Unknown error",
                        isLoading: false,
                    });
                }
            },

            createServer: async (serverData) => {
                set({ isLoading: true, error: null });
                try {
                    const response = await fetch("/api/mcp", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(serverData),
                    });

                    if (!response.ok) {
                        throw new Error("Failed to create MCP server");
                    }

                    const newServer = await response.json();
                    set((state) => ({
                        servers: [newServer, ...state.servers],
                        isLoading: false,
                    }));
                    return newServer;
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : "Unknown error",
                        isLoading: false,
                    });
                    return null;
                }
            },

            updateServer: async (id, updates) => {
                try {
                    const response = await fetch(`/api/mcp/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(updates),
                    });

                    if (!response.ok) {
                        throw new Error("Failed to update MCP server");
                    }

                    const updatedServer = await response.json();
                    set((state) => ({
                        servers: state.servers.map((s) =>
                            s.id === id ? updatedServer : s
                        ),
                    }));
                    return updatedServer;
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : "Unknown error",
                    });
                    return null;
                }
            },

            deleteServer: async (id) => {
                try {
                    const response = await fetch(`/api/mcp/${id}`, {
                        method: "DELETE",
                    });

                    if (!response.ok) {
                        throw new Error("Failed to delete MCP server");
                    }

                    set((state) => {
                        const { [id]: removedTools, ...restTools } = state.tools;
                        const { [id]: removedLoading, ...restLoading } = state.loadingServerTools;
                        void removedTools;
                        void removedLoading;
                        return {
                            servers: state.servers.filter((s) => s.id !== id),
                            tools: restTools,
                            loadingServerTools: restLoading,
                            selectedServerId:
                                state.selectedServerId === id ? null : state.selectedServerId,
                        };
                    });
                    return true;
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : "Unknown error",
                    });
                    return false;
                }
            },

            toggleServer: async (id) => {
                const server = get().servers.find((s) => s.id === id);
                if (!server) return null;
                const willBeEnabled = !server.enabled;
                const result = await get().updateServer(id, { enabled: willBeEnabled });
                if (willBeEnabled && result) {
                    get().fetchTools(id);
                }
                return result;
            },

            setSelectedServer: (id) => {
                set({ selectedServerId: id });
            },

            // Tools Actions
            fetchTools: async (serverId) => {
                set((state) => ({
                    isLoadingTools: true,
                    toolsError: null,
                    loadingServerTools: {
                        ...state.loadingServerTools,
                        [serverId]: true,
                    },
                }));
                try {
                    const response = await fetch(`/api/mcp/${serverId}/tools`);
                    if (!response.ok) {
                        const data = await response.json();
                        throw new Error(data.error || "Failed to fetch tools");
                    }
                    const toolsData: MCPToolInfo[] = await response.json();
                    set((state) => {
                        const updatedLoading = {
                            ...state.loadingServerTools,
                            [serverId]: false,
                        };
                        return {
                            tools: {
                                ...state.tools,
                                [serverId]: toolsData,
                            },
                            loadingServerTools: updatedLoading,
                            isLoadingTools: Object.values(updatedLoading).some(Boolean),
                        };
                    });
                    return toolsData;
                } catch (error) {
                    set((state) => {
                        const updatedLoading = {
                            ...state.loadingServerTools,
                            [serverId]: false,
                        };
                        return {
                            tools: {
                                ...state.tools,
                                [serverId]: state.tools[serverId] || [],
                            },
                            loadingServerTools: updatedLoading,
                            toolsError: error instanceof Error ? error.message : "Unknown error",
                            isLoadingTools: Object.values(updatedLoading).some(Boolean),
                        };
                    });
                    return [];
                }
            },

            getToolsForServer: (serverId) => {
                return get().tools[serverId] || [];
            },

            clearTools: (serverId) => {
                if (serverId) {
                    set((state) => {
                        const { [serverId]: removedToolEntry, ...rest } = state.tools;
                        const { [serverId]: removedLoadingEntry, ...restLoading } = state.loadingServerTools;
                        void removedToolEntry;
                        void removedLoadingEntry;
                        return { tools: rest, loadingServerTools: restLoading };
                    });
                } else {
                    set({ tools: {}, loadingServerTools: {} });
                }
            },
        }),
        {
            name: "mcp-store",
            partialize: (state) => ({ selectedServerId: state.selectedServerId }),
        }
    )
);
