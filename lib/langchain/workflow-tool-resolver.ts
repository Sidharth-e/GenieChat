import "server-only";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ConnectorConfig } from "../types";
import type { WorkflowToolKey } from "@/lib/workflow/types";
import { logger } from "@/lib/logger";
import { resolveDefaultTool } from "@/lib/tool/default-tools";
import { createMCPClient } from "./langchain-mcp";

/**
 * Turn a node's stored tool key into a live tool, or `undefined` when it cannot
 * be produced. `undefined` is a real answer — the connector behind the key may
 * have been deleted or disabled since the workflow was saved — and the node
 * turns it into a failure that names the server rather than an empty success.
 */
export async function resolveWorkflowTool(
  key: WorkflowToolKey,
  ctx: { userId: string; threadId?: string; connectors: ConnectorConfig[] },
): Promise<StructuredToolInterface | undefined> {
  if (key.type === "app-tool") {
    return resolveDefaultTool(key.id, ctx.userId, ctx.threadId);
  }

  const server = ctx.connectors.find((candidate) => candidate.id === key.serverId);
  if (!server || !server.enabled) {
    logger.warn(
      { toolId: key.id, serverId: key.serverId, serverName: key.serverName },
      "Workflow Tool node: connector is missing or disabled",
    );
    return undefined;
  }

  const client = createMCPClient([server]);
  if (!client) return undefined;

  const tools = await client.getTools();
  // The picker stores the name MCP itself reported; the runtime name is
  // prefixed with the server name. Accept either, and fall back to the suffix.
  return tools.find(
    (tool) =>
      tool.name === key.id ||
      tool.name === `${key.serverName}_${key.id}` ||
      tool.name.endsWith(`_${key.id}`),
  );
}
