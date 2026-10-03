"use client";

import {
    useQuery,
    useQueries,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { ConnectorConfig, ConnectorToolInfo } from "@/lib/types";

export const connectorKeys = {
    all: ["connectors"] as const,
    servers: () => [...connectorKeys.all, "servers"] as const,
    tools: (serverId: string) => [...connectorKeys.all, "tools", serverId] as const,
};

/** The fields a caller supplies when registering a connector. */
export type ConnectorInput = Pick<
    ConnectorConfig,
    "name" | "transportType"
> &
    Partial<
        Pick<
            ConnectorConfig,
            "description" | "serverUrl" | "headers" | "timeout" | "requireApproval"
        >
    >;

async function fetchToolsFor(serverId: string): Promise<ConnectorToolInfo[]> {
    const response = await fetch(`/api/connectors/${serverId}/tools`);
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
export function useConnectors(initialServers?: ConnectorConfig[]) {
    return useQuery<ConnectorConfig[]>({
        queryKey: connectorKeys.servers(),
        queryFn: async () => {
            const response = await fetch("/api/connectors");
            if (!response.ok) {
                throw new Error("Failed to fetch connectors");
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
export function useConnectorTools(
    serverIds: string[],
    enabledIds?: ReadonlySet<string>,
) {
    const queryClient = useQueryClient();

    const results = useQueries({
        queries: serverIds.map((serverId) => ({
            queryKey: connectorKeys.tools(serverId),
            queryFn: () => fetchToolsFor(serverId),
            enabled: enabledIds ? enabledIds.has(serverId) : true,
            staleTime: 1000 * 60 * 5,
        })),
    });

    const tools: Record<string, ConnectorToolInfo[]> = {};
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
        queryClient.invalidateQueries({ queryKey: connectorKeys.tools(serverId) });

    return { tools, isLoadingServerTools, toolsError, refreshTools };
}

/**
 * Registers a connector.
 */
export function useCreateConnector() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverData: ConnectorInput) => {
            const response = await fetch("/api/connectors", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(serverData),
            });

            if (!response.ok) {
                throw new Error("Failed to create connector");
            }

            return response.json() as Promise<ConnectorConfig>;
        },
        onSuccess: (newServer) => {
            queryClient.setQueryData<ConnectorConfig[]>(
                connectorKeys.servers(),
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
export function useUpdateConnector() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            id,
            updates,
        }: {
            id: string;
            updates: Partial<ConnectorConfig>;
        }) => {
            const response = await fetch(`/api/connectors/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to update connector");
            }

            return response.json() as Promise<ConnectorConfig>;
        },
        onSuccess: (updatedServer) => {
            queryClient.setQueryData<ConnectorConfig[]>(
                connectorKeys.servers(),
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
export function useDeleteConnector() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/connectors/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete connector");
            }

            return id;
        },
        onSuccess: (deletedId) => {
            queryClient.setQueryData<ConnectorConfig[]>(
                connectorKeys.servers(),
                (old) => old?.filter((server) => server.id !== deletedId),
            );
            queryClient.removeQueries({ queryKey: connectorKeys.tools(deletedId) });
        },
    });
}
