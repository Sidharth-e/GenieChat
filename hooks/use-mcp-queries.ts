"use client";

import {
    useQuery,
    useQueries,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { MCPServerConfig, MCPToolInfo } from "@/lib/types";

export const mcpKeys = {
    all: ["mcp"] as const,
    servers: () => [...mcpKeys.all, "servers"] as const,
    tools: (serverId: string) => [...mcpKeys.all, "tools", serverId] as const,
};

/** The fields a caller supplies when registering a connector. */
export type MCPServerInput = Pick<
    MCPServerConfig,
    "name" | "transportType"
> &
    Partial<
        Pick<
            MCPServerConfig,
            "description" | "serverUrl" | "headers" | "timeout" | "requireApproval"
        >
    >;

async function fetchToolsFor(serverId: string): Promise<MCPToolInfo[]> {
    const response = await fetch(`/api/mcp/${serverId}/tools`);
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to fetch tools");
    }
    return response.json();
}

/**
 * Fetches the installed connectors.
 *
 * `initialServers` is the list an RSC already read, seeded as `initialData` so
 * the list page paints without a second round trip.
 */
export function useMCPServers(initialServers?: MCPServerConfig[]) {
    return useQuery<MCPServerConfig[]>({
        queryKey: mcpKeys.servers(),
        queryFn: async () => {
            const response = await fetch("/api/mcp");
            if (!response.ok) {
                throw new Error("Failed to fetch MCP servers");
            }
            return response.json();
        },
        initialData: initialServers,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Fetches tools for several servers at once, as the three consumers that render
 * a per-server tool list need: the connector list's cards, the agent form's
 * tool options, and the workflow tool picker.
 *
 * Each server is its own query under its own key, so one server being
 * unreachable leaves the others' tools intact. `enabledIds` gates the whole
 * set; omit it to discover every server named.
 */
export function useMCPToolsByServer(
    serverIds: string[],
    enabledIds?: ReadonlySet<string>,
) {
    const queryClient = useQueryClient();

    const results = useQueries({
        queries: serverIds.map((serverId) => ({
            queryKey: mcpKeys.tools(serverId),
            queryFn: () => fetchToolsFor(serverId),
            enabled: enabledIds ? enabledIds.has(serverId) : true,
            staleTime: 1000 * 60 * 5,
        })),
    });

    const tools: Record<string, MCPToolInfo[]> = {};
    const isLoadingServerTools: Record<string, boolean> = {};
    const toolsError: Record<string, string | null> = {};

    serverIds.forEach((serverId, index) => {
        tools[serverId] = results[index]?.data ?? [];
        isLoadingServerTools[serverId] = results[index]?.isLoading ?? false;
        toolsError[serverId] = results[index]?.error
            ? (results[index].error as Error).message
            : null;
    });

    const refreshTools = (serverId: string) =>
        queryClient.invalidateQueries({ queryKey: mcpKeys.tools(serverId) });

    return { tools, isLoadingServerTools, toolsError, refreshTools };
}

/**
 * Registers a connector.
 */
export function useCreateMCPServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverData: MCPServerInput) => {
            const response = await fetch("/api/mcp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(serverData),
            });

            if (!response.ok) {
                throw new Error("Failed to create MCP server");
            }

            return response.json() as Promise<MCPServerConfig>;
        },
        onSuccess: (newServer) => {
            queryClient.setQueryData<MCPServerConfig[]>(
                mcpKeys.servers(),
                (old) => (old ? [newServer, ...old] : [newServer]),
            );
        },
    });
}

/**
 * Updates a connector.
 *
 * Enabling a server needs no extra work to discover its tools: it enters the
 * callers' `enabledIds` set, which is what turns its tools query on.
 */
export function useUpdateMCPServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            id,
            updates,
        }: {
            id: string;
            updates: Partial<MCPServerConfig>;
        }) => {
            const response = await fetch(`/api/mcp/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to update MCP server");
            }

            return response.json() as Promise<MCPServerConfig>;
        },
        onSuccess: (updatedServer) => {
            queryClient.setQueryData<MCPServerConfig[]>(
                mcpKeys.servers(),
                (old) =>
                    old?.map((server) =>
                        server.id === updatedServer.id ? updatedServer : server,
                    ),
            );
        },
    });
}

/**
 * Deletes a connector, dropping its tools from the cache with it.
 */
export function useDeleteMCPServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/mcp/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete MCP server");
            }

            return id;
        },
        onSuccess: (deletedId) => {
            queryClient.setQueryData<MCPServerConfig[]>(
                mcpKeys.servers(),
                (old) => old?.filter((server) => server.id !== deletedId),
            );
            queryClient.removeQueries({ queryKey: mcpKeys.tools(deletedId) });
        },
    });
}
