import "server-only";
import { logger } from "@/lib/logger";
import {
    HumanMessage,
    AIMessage,
    SystemMessage,
    ToolMessage,
    BaseMessage,
} from "@langchain/core/messages";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { StructuredToolInterface } from "@langchain/core/tools";

import { Message, ConnectorConfig } from "../types";
import { createMCPClient } from "./langchain-mcp";
import { getModel } from "./model-factory";
import { ModelOptions } from "./model-config";
import { resolveDefaultTool } from "../tool/default-tools";
import { replacePromptVariables, UserContext } from "./langchain-utility";
import {
    convertToLangChainMessages,
    extractTextFromContent,
} from "./langchain-message-utils";

// --- Event Interface ---
export interface AgentStreamEvent {
    type: "token" | "token_usage" | "tool_call_start" | "tool_call_end" | "tool_result" | "citations" | "error" | "done";
    content?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolCallId?: string;
    agentId?: string;
    agentName?: string;
    citations?: string[];
    error?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export class MultiAgentService {
    private normalizeAgentNode(value: string): string {
        return value.trim().toLowerCase().replace(/\s+/g, "_");
    }

    private isSupervisorNode(
        activeNode: string | undefined,
        subAgentDirectory: Map<string, { id: string; name: string }>,
    ): boolean {
        if (!activeNode) {
            return true;
        }

        return !subAgentDirectory.has(this.normalizeAgentNode(activeNode))
            && this.resolveAgentFromNode(activeNode, subAgentDirectory).agentId === undefined;
    }

    private extractTokenContent(rawContent: unknown): string {
        return extractTextFromContent(rawContent);
    }

    private sanitizeMessagesForModel(messages: BaseMessage[]): BaseMessage[] {
        return messages.map((message) => {
            const messageType = message._getType();
            const responseMetadata = {
                ...(message.response_metadata ?? {}),
            };

            if (messageType === "ai") {
                const aiMessage = message as AIMessage;
                const safeContent = extractTextFromContent(aiMessage.content);
                if (
                    "output_version" in responseMetadata &&
                    responseMetadata.output_version === "v1"
                ) {
                    delete responseMetadata.output_version;
                }
                if (
                    Array.isArray(aiMessage.content) &&
                    aiMessage.content.some(
                        (part) =>
                            typeof part === "object" &&
                            part !== null &&
                            "type" in part &&
                            (part as { type?: unknown }).type !== "text",
                    )
                ) {
                    logger.warn(
                        "[Multi-Agent] Normalizing assistant content blocks for model compatibility.",
                    );
                }
                return new AIMessage({
                    content: safeContent,
                    name: aiMessage.name,
                    id: aiMessage.id,
                    tool_calls: aiMessage.tool_calls,
                    invalid_tool_calls: aiMessage.invalid_tool_calls,
                    usage_metadata: aiMessage.usage_metadata,
                    additional_kwargs: aiMessage.additional_kwargs,
                    response_metadata: responseMetadata,
                });
            }

            if (messageType === "tool") {
                const toolMessage = message as ToolMessage;
                if (
                    "output_version" in responseMetadata &&
                    responseMetadata.output_version === "v1"
                ) {
                    delete responseMetadata.output_version;
                }
                return new ToolMessage({
                    content:
                        typeof toolMessage.content === "string"
                            ? toolMessage.content
                            : JSON.stringify(toolMessage.content),
                    tool_call_id: toolMessage.tool_call_id,
                    name: toolMessage.name,
                    id: toolMessage.id,
                    additional_kwargs: toolMessage.additional_kwargs,
                    response_metadata: responseMetadata,
                });
            }

            if (messageType === "system") {
                const systemMessage = message as SystemMessage;
                if (
                    "output_version" in responseMetadata &&
                    responseMetadata.output_version === "v1"
                ) {
                    delete responseMetadata.output_version;
                }
                return new SystemMessage({
                    content: extractTextFromContent(systemMessage.content),
                    name: systemMessage.name,
                    id: systemMessage.id,
                    additional_kwargs: systemMessage.additional_kwargs,
                    response_metadata: responseMetadata,
                });
            }

            if (messageType === "human") {
                const humanMessage = message as HumanMessage;
                // Preserve original user multimodal parts when present.
                return new HumanMessage({
                    content: humanMessage.content,
                    name: humanMessage.name,
                    id: humanMessage.id,
                    additional_kwargs: humanMessage.additional_kwargs,
                    response_metadata: responseMetadata,
                });
            }

            return message;
        });
    }

    private createPreModelHook() {
        return (state: {
            messages?: BaseMessage[];
            llmInputMessages?: BaseMessage[];
        }) => {
            const sourceMessages = Array.isArray(state.llmInputMessages)
                ? state.llmInputMessages
                : Array.isArray(state.messages)
                    ? state.messages
                    : [];

            return {
                llmInputMessages: this.sanitizeMessagesForModel(sourceMessages),
            };
        };
    }

    private resolveAgentFromNode(
        activeNode: string | undefined,
        subAgentDirectory: Map<string, { id: string; name: string }>,
    ): { agentId?: string; agentName: string } {
        if (!activeNode) {
            return { agentName: "Supervisor" };
        }

        const directMatch = subAgentDirectory.get(this.normalizeAgentNode(activeNode));
        if (directMatch) {
            return {
                agentId: directMatch.id,
                agentName: directMatch.name,
            };
        }

        const nodeParts = activeNode.split(/[.:/]/).filter(Boolean);
        for (const part of nodeParts) {
            const partMatch = subAgentDirectory.get(this.normalizeAgentNode(part));
            if (partMatch) {
                return {
                    agentId: partMatch.id,
                    agentName: partMatch.name,
                };
            }
        }

        const normalizedActiveNode = this.normalizeAgentNode(activeNode);
        for (const [normalizedKey, agent] of subAgentDirectory) {
            if (
                normalizedActiveNode.includes(normalizedKey) ||
                normalizedKey.includes(normalizedActiveNode)
            ) {
                return {
                    agentId: agent.id,
                    agentName: agent.name,
                };
            }
        }

        if (this.normalizeAgentNode(activeNode).includes("supervisor")) {
            return { agentName: "Supervisor" };
        }

        return { agentName: activeNode };
    }

    /**
     * Helper to resolve MCP tools and default tools by string names
     * Always includes alwaysEnabled tools (e.g., knowledge_base_search)
     */
    private async resolveTools(
        allowed: string[] | undefined,
        allConnectorTools: StructuredToolInterface[],
        customToolsLookup?: Map<string, StructuredToolInterface>,
        userId?: string,
        threadId?: string,
    ) {
        let resolved: StructuredToolInterface[] = [];
        if (allowed) {
            const filteredConnectorTools = allConnectorTools.filter(tool => 
                allowed.some(a => {
                    const suffix = a.split(":").pop();
                    if (!suffix) return false;
                    return (
                        tool.name === a ||
                        tool.name === suffix ||
                        tool.name.endsWith(`_${suffix}`)
                    );
                })
            );
            resolved = [...resolved, ...filteredConnectorTools];

            const defaults = allowed
                .filter(t => t.startsWith('default:'))
                .map(t => t.split(':')[1])
                .map(name => resolveDefaultTool(name, userId, threadId))
                .filter(
                    (t): t is NonNullable<typeof t> => t !== undefined,
                );

            resolved = [...resolved, ...defaults];

            if (customToolsLookup && customToolsLookup.size > 0) {
                const customTools = allowed
                    .map((selection) => customToolsLookup.get(selection))
                    .filter(
                        (tool): tool is StructuredToolInterface =>
                            tool !== undefined,
                    );

                resolved = [...resolved, ...customTools];
            }
        }

        // Always include alwaysEnabled tools (e.g., knowledge_base_search, use_skill)
        const { DEFAULT_TOOLS_METADATA } = await import("../tool/default-tools-metadata");
        const alwaysEnabledToolNames = DEFAULT_TOOLS_METADATA
            .filter(t => t.alwaysEnabled)
            .map(t => t.name);

        for (const toolName of alwaysEnabledToolNames) {
            if (resolved.some(t => t.name === toolName)) continue;
            const staticTool = resolveDefaultTool(toolName, userId, threadId);
            if (staticTool) {
                resolved.push(staticTool);
                continue;
            }
            const dynamicTool = customToolsLookup?.get(toolName);
            if (dynamicTool) {
                resolved.push(dynamicTool);
            }
        }

        return Array.from(
            new Map(resolved.map((tool) => [tool.name, tool])).values(),
        );
    }

    /**
     * Streams the Multi-Agent workflow using createSupervisor
     */
    async *streamAgent(params: {
        messages: Message[];
        modelId: string;
        systemPrompt: string;
        connectors?: ConnectorConfig[];
        images?: { base64Data: string; mimeType: string }[];
        modelOptions?: Pick<ModelOptions, "temperature" | "topP">;
        userContext?: UserContext;
        customToolsLookup?: Map<string, StructuredToolInterface>;
        subAgents: {
            id: string;
            name: string;
            systemPrompt?: string;
            modelId?: string;
            temperature?: number;
            topP?: number;
            allowedTools?: string[];
        }[];
    }): AsyncGenerator<AgentStreamEvent, void, unknown> {

        try {
            if (!params.subAgents?.length) {
                throw new Error("No sub-agents configured for multi-agent execution.");
            }

            const supervisorModel = getModel(params.modelId, params.modelOptions);
            
            // 1. Initialize connector tools
            let allConnectorTools: StructuredToolInterface[] = [];
            if (params.connectors?.length) {
                const mcpClient = createMCPClient(params.connectors);
                if (mcpClient) allConnectorTools = await mcpClient.getTools();
            }

            // 2. Prepare Sub-Agent (Worker) Configurations using createReactAgent
            const { createReactAgent } = await import("@langchain/langgraph/prebuilt");
            const subAgentDirectory = new Map<string, { id: string; name: string }>();
            const preModelHook = this.createPreModelHook();
            
            const compiledAgents = await Promise.all(params.subAgents.map(async (sa) => {
                const subTools = await this.resolveTools(
                    sa.allowedTools,
                    allConnectorTools,
                    params.customToolsLookup,
                    params.userContext?.userId,
                    params.userContext?.threadId,
                );
                const subModel = getModel(sa.modelId || params.modelId, {
                    temperature: sa.temperature ?? params.modelOptions?.temperature,
                    topP: sa.topP ?? params.modelOptions?.topP,
                });
                const normalizedAgentName = sa.name.replace(/\s+/g, "_");

                subAgentDirectory.set(this.normalizeAgentNode(sa.name), {
                    id: sa.id,
                    name: sa.name,
                });
                subAgentDirectory.set(this.normalizeAgentNode(normalizedAgentName), {
                    id: sa.id,
                    name: sa.name,
                });
                
                // Create a compiled react agent for each sub-agent
                const agent = createReactAgent({
                    llm: subModel,
                    tools: subTools,
                    name: normalizedAgentName,
                    prompt: sa.systemPrompt || `You are a specialist for ${sa.name}.`,
                    preModelHook,
                });
                
                return agent;
            }));

            // 3. Create the Supervisor Workflow
            const workflow = createSupervisor({
                agents: compiledAgents as unknown as Parameters<typeof createSupervisor>[0]["agents"],
                llm: supervisorModel,
                prompt: replacePromptVariables(params.systemPrompt, params.userContext),
                preModelHook,
            });

            const app = workflow.compile();

            // 4. Stream Results
            const startMessages = convertToLangChainMessages({
                messages: params.messages,
                images: params.images,
            });
            const eventStream = app.streamEvents(
                { messages: startMessages },
                { version: "v2", recursionLimit: 100 }
            );

            for await (const event of eventStream) {
                // The metadata tells us which node (agent) is active
                const activeNode = typeof event.metadata?.langgraph_node === "string"
                    ? event.metadata.langgraph_node
                    : undefined;
                const { agentId, agentName } = this.resolveAgentFromNode(activeNode, subAgentDirectory);

                if (event.event === "on_chat_model_stream") {
                    if (!this.isSupervisorNode(activeNode, subAgentDirectory)) {
                        continue;
                    }

                    const content = this.extractTokenContent(event.data.chunk.content);
                    if (content) {
                        yield {
                            type: "token",
                            content,
                            agentId,
                            agentName,
                        };
                    }
                } else if (event.event === "on_tool_start") {
                    yield {
                        type: "tool_call_start",
                        toolName: event.name,
                        toolArgs: event.data.input,
                        toolCallId: event.run_id,
                        agentId,
                        agentName,
                    };
                } else if (event.event === "on_tool_end") {
                    yield {
                        type: "tool_result",
                        toolName: event.name,
                        toolResult: JSON.stringify(event.data.output),
                        toolCallId: event.run_id,
                        agentId,
                        agentName,
                    };
                } else if (event.event === "on_chat_model_end") {
                    const output = event.data?.output;
                    const responseMeta = output?.response_metadata;
                    const usage =
                        output?.usage_metadata ||
                        responseMeta?.tokenUsage ||
                        responseMeta?.usage;
                    const promptTokens =
                        usage?.input_tokens ??
                        usage?.prompt_tokens ??
                        usage?.promptTokens ??
                        responseMeta?.prompt_eval_count ??
                        0;
                    const completionTokens =
                        usage?.output_tokens ??
                        usage?.completion_tokens ??
                        usage?.completionTokens ??
                        responseMeta?.eval_count ??
                        0;
                    const totalTokens =
                        usage?.total_tokens ??
                        usage?.totalTokens ??
                        (promptTokens + completionTokens);
                    if (totalTokens > 0) {
                        yield {
                            type: "token_usage",
                            promptTokens,
                            completionTokens,
                            totalTokens,
                            agentId,
                            agentName,
                        };
                    }
                }
            }

            yield { type: "done" };

        } catch (error) {
            logger.error("Multi-Agent Error:", error);
            yield {
                type: "error",
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }
}

// Singleton instance for use in your API/Routes
export const multiAgentService = new MultiAgentService();
