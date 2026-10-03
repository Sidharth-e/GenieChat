import "server-only";
import { logger } from "@/lib/logger";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ConnectorConfig, ConnectorTransportType } from "../types";

// Map our transport types to LangChain transport types
type LangChainTransport = "sse" | "http";

function mapTransportType(type: ConnectorTransportType): LangChainTransport {
    switch (type) {
        case "sse":
            return "sse";
        case "http":
            return "http";
        default:
            return "http";
    }
}

// Build MCP client configuration from our server configs
export function buildMCPClientConfig(servers: ConnectorConfig[]): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    for (const server of servers) {
        if (!server.enabled) continue;
        if ((server.transportType !== "http" && server.transportType !== "sse") || !server.serverUrl) {
            logger.warn(`Skipping unsupported or invalid MCP transport for server: ${server.name}`);
            continue;
        }

        config[server.name] = {
            transport: mapTransportType(server.transportType),
            url: server.serverUrl,
            headers: server.headers || undefined,
        };
    }

    return config;
}

// Create MCP client from server configurations
export function createMCPClient(servers: ConnectorConfig[]): MultiServerMCPClient | null {
    const enabledServers = servers.filter((s) => s.enabled);
    if (enabledServers.length === 0) {
        return null;
    }

    const mcpServers = buildMCPClientConfig(enabledServers);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new MultiServerMCPClient({ mcpServers } as any);
}

// Tool info returned from MCP servers
export interface ConnectorToolInfo {
    name: string;
    description: string;
    serverName: string;
    inputSchema?: Record<string, unknown>;
}

// Get tools from all configured MCP servers
export async function getMCPTools(servers: ConnectorConfig[]): Promise<ConnectorToolInfo[]> {
    const client = createMCPClient(servers);
    if (!client) {
        return [];
    }

    try {
        const tools = await client.getTools();

        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description || "",
            serverName: extractServerName(tool.name, servers),
            inputSchema: tool.schema as Record<string, unknown> | undefined,
        }));
    } catch (error) {
        logger.error("Error fetching MCP tools:", error);
        throw error;
    }
}

// Extract server name from tool (tools are prefixed with server name)
function extractServerName(toolName: string, servers: ConnectorConfig[]): string {
    for (const server of servers) {
        if (toolName.startsWith(`${server.name}_`) || toolName.includes(server.name)) {
            return server.name;
        }
    }
    return "unknown";
}

// Get tools for a specific server
export async function getToolsForServer(server: ConnectorConfig): Promise<ConnectorToolInfo[]> {
    if (!server.enabled) {
        return [];
    }

    const client = createMCPClient([server]);
    if (!client) {
        return [];
    }

    try {
        const tools = await client.getTools();

        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description || "",
            serverName: server.name,
            inputSchema: tool.schema as Record<string, unknown> | undefined,
        }));
    } catch (error) {
        logger.error(`Error fetching tools for server ${server.name}:`, error);
        throw error;
    }
}
