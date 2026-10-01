import { logger } from "@/lib/logger";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { convertCustomToolToLangChain } from "@/lib/tool/custom-tool-converter";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Agent, MCPServerConfig, ToolSecret } from "@/lib/types";
import { toSnakeCase, type CustomToolSelection } from "./tooling";

// The two pure helpers live in `tooling.ts` so they stay importable without an
// environment; re-exported here so adapters have one place to reach for.
export { toSnakeCase, filterMcpServers } from "./tooling";
export type { CustomToolSelection } from "./tooling";

export interface UserTooling {
  allServers: MCPServerConfig[];
  customTools: StructuredToolInterface[];
  customToolsLookup: Map<string, StructuredToolInterface>;
  secretMap: Record<string, string>;
}

export interface AgentContext extends UserTooling {
  /** Null when the agent id named no record, or the database is unconfigured. */
  agent: Agent | null;
  allowedTools?: string[];
  /**
   * The identity prompt plus the skill catalog, exactly as both routes append
   * them to `effectiveSystemPrompt`. `agent.systemPrompt` is already mutated
   * with the same text — the callers append this to their own copy.
   */
  systemPromptSuffix: string;
}

function emptyTooling(): UserTooling {
  return {
    allServers: [],
    customTools: [],
    customToolsLookup: new Map(),
    secretMap: {},
  };
}

/**
 * Converts the user's custom tools and indexes them. A failure here is logged
 * and swallowed, as it is in all three routes — losing custom tools degrades
 * the agent, it does not fail the request.
 */
function buildCustomTooling(
  userCustomTools: unknown[],
  selection: CustomToolSelection,
  allowedTools: string[] | undefined,
  secretMap: Record<string, string>,
  logPrefix: string,
): Pick<UserTooling, "customTools" | "customToolsLookup"> {
  const customTools: StructuredToolInterface[] = [];
  const customToolsLookup = new Map<string, StructuredToolInterface>();

  try {
    const enabled = (
      userCustomTools as Array<{
        id: string;
        name: string;
        enabled: boolean;
      }>
    ).filter((tool) => tool.enabled);

    if (selection === "allowed-only") {
      if (!allowedTools || allowedTools.length === 0) {
        return { customTools, customToolsLookup };
      }

      const allowedSet = new Set(allowedTools);
      for (const tool of enabled) {
        const aliases = [
          `custom:${tool.id}`,
          `custom:${tool.name}`,
          tool.id,
          tool.name,
          toSnakeCase(tool.name),
        ];
        if (!aliases.some((alias) => allowedSet.has(alias))) continue;

        const structuredTool = convertCustomToolToLangChain(
          tool as never,
          secretMap,
        );
        customTools.push(structuredTool);
        aliases.forEach((alias) => customToolsLookup.set(alias, structuredTool));
      }

      if (customTools.length > 0) {
        logger.info(
          `Loaded ${customTools.length} custom tools for ${logPrefix}`,
        );
      }

      return { customTools, customToolsLookup };
    }

    for (const tool of enabled) {
      const structuredTool = convertCustomToolToLangChain(tool as never, secretMap);
      const aliases = [
        `custom:${tool.id}`,
        `custom:${tool.name}`,
        tool.id,
        tool.name,
        toSnakeCase(tool.name),
        structuredTool.name,
      ];
      aliases.forEach((alias) => customToolsLookup.set(alias, structuredTool));
      customTools.push(structuredTool);
    }

    if (customToolsLookup.size > 0) {
      logger.info(`Loaded ${customToolsLookup.size} custom tool aliases`);
    }
  } catch (err) {
    logger.warn(`Failed to load custom tools for ${logPrefix}:`, err);
  }

  return { customTools, customToolsLookup };
}

/**
 * Everything that depends only on the user, not on any agent record — which is
 * all swarm can load, since it has no main agent.
 */
export async function loadUserTooling(params: {
  userId: string;
  customToolSelection: CustomToolSelection;
  /** Only consulted when `customToolSelection` is "allowed-only". */
  allowedTools?: string[];
}): Promise<UserTooling> {
  const result = emptyTooling();

  const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;
  if (!mcpStore) return result;

  try {
    const secretStore = new SecretStore();
    const toolStore = new ToolStore();

    const [userSecrets, userCustomTools, allServers] = await Promise.all([
      isDatabaseConfigured()
        ? secretStore.getSecrets(params.userId)
        : Promise.resolve([] as ToolSecret[]),
      toolStore.getTools(params.userId),
      mcpStore.getMCPServers(params.userId),
    ]);

    result.allServers = allServers;
    result.secretMap = userSecrets.reduce<Record<string, string>>(
      (acc, secret) => {
        acc[secret.name] = secret.value;
        return acc;
      },
      {},
    );

    Object.assign(
      result,
      buildCustomTooling(
        userCustomTools,
        params.customToolSelection,
        params.allowedTools,
        result.secretMap,
        "user tooling",
      ),
    );
  } catch (err) {
    logger.warn("Error fetching agent settings or MCP servers:", err);
  }

  return result;
}

/**
 * `loadUserTooling` plus the agent record, its identity prompt and its skill
 * catalog. Used by agent and multi-agent — swarm has no main agent and never
 * calls this.
 *
 * Deliberately does not reject a disabled agent: one route enforces that and
 * the other does not, so the check stays at the route.
 */
export async function loadAgentContext(params: {
  userId: string;
  agentId: string;
  customToolSelection: CustomToolSelection;
  logPrefix: string;
}): Promise<AgentContext> {
  const result: AgentContext = {
    ...emptyTooling(),
    agent: null,
    allowedTools: undefined,
    systemPromptSuffix: "",
  };

  const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
  const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;
  if (!agentStore || !mcpStore) return result;

  try {
    const secretStore = new SecretStore();
    const toolStore = new ToolStore();

    // Single round: secrets, agent config, tools and MCP servers are independent.
    const [userSecrets, fetchedAgent, userCustomTools, allServers] =
      await Promise.all([
        isDatabaseConfigured()
          ? secretStore.getSecrets(params.userId)
          : Promise.resolve([] as ToolSecret[]),
        params.agentId
          ? agentStore.getAgent(params.agentId)
          : Promise.resolve(null),
        toolStore.getTools(params.userId),
        mcpStore.getMCPServers(params.userId),
      ]);

    result.allServers = allServers;
    result.secretMap = userSecrets.reduce<Record<string, string>>(
      (acc, secret) => {
        acc[secret.name] = secret.value;
        return acc;
      },
      {},
    );

    if (fetchedAgent) {
      result.agent = fetchedAgent;

      const identityPrompt = `\n\nSYSTEM INFO:\nYou are an AI agent named "${fetchedAgent.name}".\nYour Agent ID is "${fetchedAgent.id}".\nIf you need to search your knowledge base using the 'knowledge_base_search' tool, you SHOULD provide this Agent ID to filter results specific to you.`;

      let suffix = identityPrompt;
      fetchedAgent.systemPrompt = (fetchedAgent.systemPrompt || "") + identityPrompt;

      if (fetchedAgent.skills && fetchedAgent.skills.length > 0) {
        const catalog = fetchedAgent.skills
          .map((s) => `- **${s.name}**: ${s.description}`)
          .join("\n");
        const skillCatalogBlock = `\n\n# Available Skills\n\nYou have the following skills available. To activate a skill and receive its full instructions, call the \`use_skill\` tool with the skill name.\n\n${catalog}`;
        suffix += skillCatalogBlock;
        fetchedAgent.systemPrompt =
          (fetchedAgent.systemPrompt || "") + skillCatalogBlock;
      }

      result.systemPromptSuffix = suffix;

      if (fetchedAgent.tools && fetchedAgent.tools.length > 0) {
        result.allowedTools = fetchedAgent.tools;
        logger.info(`Agent allows ${result.allowedTools.length} tools`);
      }
    }
    logger.info(`Allowed tools: ${result.allowedTools?.join(", ")}`);

    Object.assign(
      result,
      buildCustomTooling(
        userCustomTools,
        params.customToolSelection,
        result.allowedTools,
        result.secretMap,
        params.logPrefix,
      ),
    );
  } catch (err) {
    logger.warn("Error fetching agent settings or MCP servers:", err);
  }

  return result;
}
