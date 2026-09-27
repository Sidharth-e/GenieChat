import "server-only";
import { logger } from "@/lib/logger";
import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    SystemMessage,
    ToolMessage,
    HumanMessage,
} from "@langchain/core/messages";
import { Annotation, MessagesAnnotation, Send, START, END, StateGraph } from "@langchain/langgraph";
import { StructuredToolInterface } from "@langchain/core/tools";


import { Message, MCPServerConfig } from "../types";
import { createMCPClient } from "./langchain-mcp";
import { getModel } from "./model-factory";
import { ModelOptions } from "./model-config";
import defaultToolsMap from "../tool/default-tools";
import { replacePromptVariables, UserContext } from "./langchain-utility";
import {
    convertToLangChainMessages,
    extractTextFromContent,
} from "./langchain-message-utils";

// --- Types ---

export interface SwarmAgentConfig {
    id: string;
    name: string;
    description?: string;
    systemPrompt?: string;
    modelId?: string;
    temperature?: number;
    topP?: number;
    allowedTools?: string[];
}

export interface SwarmStreamEvent {
    type:
        | "agent_turn_start"
        | "agent_turn_end"
        | "token"
        | "token_usage"
        | "tool_call_start"
        | "tool_call_end"
        | "tool_result"
        | "routing"
        | "round_start"
        | "round_end"
        | "citations"
        | "error"
        | "done";
    content?: string;
    agentId?: string;
    agentName?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolCallId?: string;
    citations?: string[];
    error?: string;
    round?: number;
    routedAgents?: string[];
    routingReason?: "mention" | "llm_fallback";
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

type AgentRosterEntry = {
    id: string;
    name: string;
    description?: string;
    normalizedName: string;
};


// --- State Schema ---

const SwarmState = Annotation.Root({
    ...MessagesAnnotation.spec,
    activeAgents: Annotation<string[]>({
        reducer: (_, b) => b,
        default: () => [],
    }),
    roundCount: Annotation<number>({
        reducer: (_, b) => b,
        default: () => 0,
    }),
    maxRounds: Annotation<number>({
        reducer: (_, b) => b,
        default: () => 5,
    }),
    preRoundMessageCount: Annotation<number>({
        reducer: (_, b) => b,
        default: () => 0,
    }),
    allSkipRetried: Annotation<boolean>({
        reducer: (_, b) => b,
        default: () => false,
    }),
});

// --- Mention Parser ---

const MENTION_REGEX = /@\[([^\]]+)\]|@(\w+)/g;

function parseMentions(text: string, roster: AgentRosterEntry[]): AgentRosterEntry[] {
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = MENTION_REGEX.exec(text)) !== null) {
        mentions.push((match[1] || match[2]).toLowerCase());
    }
    MENTION_REGEX.lastIndex = 0;

    if (mentions.length === 0) return [];

    const matched = new Map<string, AgentRosterEntry>();
    for (const mention of mentions) {
        for (const agent of roster) {
            if (matched.has(agent.id)) continue;
            const nameLower = agent.name.toLowerCase();
            const normalizedLower = agent.normalizedName.toLowerCase();
            if (
                nameLower.startsWith(mention) ||
                normalizedLower.startsWith(mention) ||
                nameLower.includes(mention)
            ) {
                matched.set(agent.id, agent);
                break;
            }
        }
    }

    return Array.from(matched.values());
}

// --- Swarm Agent Service ---

export class SwarmAgentService {
    private sanitizeMessagesForModel(messages: BaseMessage[]): BaseMessage[] {
        return messages.map((message) => {
            const messageType = message._getType();
            const responseMetadata = {
                ...(message.response_metadata ?? {}),
            };
            if (
                "output_version" in responseMetadata &&
                responseMetadata.output_version === "v1"
            ) {
                delete responseMetadata.output_version;
            }

            if (messageType === "ai") {
                const aiMessage = message as AIMessage;
                return new AIMessage({
                    content: extractTextFromContent(aiMessage.content),
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

            const sanitized = this.sanitizeMessagesForModel(sourceMessages);

            // Most chat APIs reject a conversation ending with an assistant turn.
            // In multi-agent rounds, prior agents' responses sit at the end of the
            // history when a new agent starts. Append a minimal human turn to satisfy
            // the constraint without altering the actual conversation content.
            const lastMsg = sanitized[sanitized.length - 1];
            if (lastMsg && lastMsg._getType() === "ai") {
                sanitized.push(new HumanMessage("Continue."));
            }

            return {
                llmInputMessages: sanitized,
            };
        };
    }

    private async resolveTools(
        allowed: string[] | undefined,
        allMcpTools: StructuredToolInterface[],
        customToolsLookup?: Map<string, StructuredToolInterface>,
        messages?: Message[],
    ) {
        let resolved: StructuredToolInterface[] = [];
        if (allowed) {
            const mcpFiltered = allMcpTools.filter(tool =>
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
            resolved = [...resolved, ...mcpFiltered];

            const defaults = allowed
                .filter(t => t.startsWith("default:"))
                .map(t => t.split(":")[1])
                .map(name => defaultToolsMap[name])
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

        const { DEFAULT_TOOLS_METADATA } = await import("../tool/default-tools-metadata");
        const alwaysEnabledToolNames = DEFAULT_TOOLS_METADATA
            .filter(t => t.alwaysEnabled)
            .map(t => t.name);

        for (const toolName of alwaysEnabledToolNames) {
            if (resolved.some(t => t.name === toolName)) continue;
            const staticTool = defaultToolsMap[toolName];
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

    private buildTeamPromptSuffix(roster: AgentRosterEntry[]): string {
        const agentList = roster
            .map((a) => `- @[${a.name}]: ${a.description || "Team member"}`)
            .join("\n");

        return `\n\nYou are part of a team discussion. Other agents in this conversation:
${agentList}

PARALLEL EXECUTION: All agents receive the user's message at the same time and respond IN PARALLEL.
The other agents are ALREADY working on their parts RIGHT NOW as you read this.
- Do NOT hand off or delegate work to another agent — they are already doing their part
- Do NOT ask another agent to do something — they are already on it
- Do NOT mention another agent with @[Agent Name] — they don't need your instruction
- Focus ONLY on the parts of the request that match YOUR expertise
- If the request has multiple parts, handle ONLY what you're best at and trust others to handle theirs

SELF-SELECTION: Before responding, evaluate whether this message is relevant to YOUR expertise.
- If the message is NOT relevant to you, respond with ONLY the exact text: [SKIP]
- Do NOT explain why you are skipping. Just output [SKIP] and nothing else.
- If the message IS relevant to you, respond normally with your full answer.
- If the user @mentions you by name (e.g., @[${roster[0]?.name || "Your Name"}]), you MUST respond — do not skip.
- If the message is a social message (thanks, hello, goodbye) directed at the whole group, you may respond briefly.

@mentioning other agents:
- ONLY use @[Agent Name] if the USER explicitly asked you to hand off to them AND they were not already part of the original parallel request.
- NEVER mention another agent just because the topic seems related to their skills.
- NEVER mention another agent for social messages.
- If in doubt, do NOT mention anyone. Unnecessary mentions cause infinite loops.`;
    }

    async *streamSwarm(params: {
        messages: Message[];
        agents: SwarmAgentConfig[];
        defaultModelId: string;
        mcpServers?: MCPServerConfig[];
        images?: { base64Data: string; mimeType: string }[];
        modelOptions?: Pick<ModelOptions, "temperature" | "topP">;
        userContext?: UserContext;
        customToolsLookup?: Map<string, StructuredToolInterface>;
        maxRounds?: number;
    }): AsyncGenerator<SwarmStreamEvent, void, unknown> {
        try {
            if (!params.agents?.length || params.agents.length < 2) {
                throw new Error("Swarm requires at least 2 agents.");
            }

            // 1. Initialize MCP tools
            let allMcpTools: StructuredToolInterface[] = [];
            if (params.mcpServers?.length) {
                const mcpClient = createMCPClient(params.mcpServers);
                if (mcpClient) allMcpTools = await mcpClient.getTools();
            }

            // 2. Build agent roster
            const roster: AgentRosterEntry[] = params.agents.map((a) => ({
                id: a.id,
                name: a.name,
                description: a.description,
                normalizedName: a.name.trim().toLowerCase().replace(/\s+/g, "_"),
            }));

            const agentConfigMap = new Map(params.agents.map((a) => [a.id, a]));
            const rosterByNormalized = new Map(roster.map((r) => [r.normalizedName, r]));

            // 3. Build createReactAgent subgraphs
            const { createReactAgent } = await import("@langchain/langgraph/prebuilt");
            const preModelHook = this.createPreModelHook();
            const teamSuffix = this.buildTeamPromptSuffix(roster);

            const agentSubgraphs = new Map<string, ReturnType<typeof createReactAgent>>();

            for (const entry of roster) {
                const config = agentConfigMap.get(entry.id)!;
                const model = getModel(config.modelId || params.defaultModelId, {
                    temperature: config.temperature ?? params.modelOptions?.temperature,
                    topP: config.topP ?? params.modelOptions?.topP,
                });
                const tools = await this.resolveTools(
                    config.allowedTools,
                    allMcpTools,
                    params.customToolsLookup,
                    params.messages,
                );
                const basePrompt = replacePromptVariables(
                    config.systemPrompt || `You are ${config.name}. ${config.description || ""}`,
                    params.userContext,
                );

                const agent = createReactAgent({
                    llm: model,
                    tools,
                    name: entry.normalizedName,
                    prompt: basePrompt + teamSuffix,
                    preModelHook,
                });

                agentSubgraphs.set(entry.normalizedName, agent);
            }

            // 4. Build StateGraph
            const baseMessages = convertToLangChainMessages({
                messages: params.messages,
                images: params.images,
            });

            const maxRounds = params.maxRounds ?? 5;

            // Broadcast node — decides which agents run each round
            const broadcastNode = (state: typeof SwarmState.State) => {
                const currentRound = state.roundCount + 1;

                // Max rounds guard
                if (currentRound > maxRounds) {
                    return {
                        activeAgents: [],
                        roundCount: currentRound,
                        preRoundMessageCount: state.messages.length,
                    };
                }

                // Round 1: route ALL agents (they self-select via [SKIP])
                if (currentRound === 1) {
                    return {
                        activeAgents: roster.map((a) => a.normalizedName),
                        roundCount: currentRound,
                        preRoundMessageCount: state.messages.length,
                    };
                }

                // Round 2+: only route agents @mentioned in previous round's responses
                const newMessages = state.messages.slice(state.preRoundMessageCount);
                const agentResponseTexts = newMessages
                    .filter((m) => m._getType() === "ai")
                    .map((m) => extractTextFromContent(m.content));

                const sourceText = agentResponseTexts.join("\n");
                let mentionedAgents = parseMentions(sourceText, roster);

                // Cross-mention filtering: filter out agents that just responded (self-mentions)
                if (mentionedAgents.length > 0 && state.activeAgents.length > 0) {
                    const currentAgents = new Set(state.activeAgents);
                    mentionedAgents = mentionedAgents.filter(
                        (a) => !currentAgents.has(a.normalizedName),
                    );
                }

                return {
                    activeAgents: mentionedAgents.map((a) => a.normalizedName),
                    roundCount: currentRound,
                    preRoundMessageCount: state.messages.length,
                };
            };

            // Collector node — fan-in point, handles all-skip retry
            const collectorNode = (state: typeof SwarmState.State) => {
                // Only check for all-skip on round 1
                if (state.roundCount !== 1) {
                    return {};
                }

                const newMessages = state.messages.slice(state.preRoundMessageCount);
                const agentResponses = newMessages.filter((m) => m._getType() === "ai");

                const allSkipped = agentResponses.length > 0 && agentResponses.every((m) => {
                    const text = extractTextFromContent(m.content).trim();
                    return text === "[SKIP]";
                });

                if (allSkipped && !state.allSkipRetried) {
                    // Inject nudge and reset for retry
                    return {
                        messages: [
                            new HumanMessage(
                                "None of the agents responded. Please reconsider — at least one of you should be able to help with this request. Try again.",
                            ),
                        ],
                        roundCount: 0,
                        allSkipRetried: true,
                    };
                }

                return {};
            };

            // Broadcast conditional edge — injects parallel context per agent
            const broadcastEdge = (state: typeof SwarmState.State) => {
                if (state.activeAgents.length === 0) {
                    return END;
                }

                return state.activeAgents.map((name) => {
                    const messages = [...state.messages];

                    if (state.activeAgents.length > 1) {
                        const thisAgent = rosterByNormalized.get(name);
                        const otherAgents = state.activeAgents
                            .filter((n) => n !== name)
                            .map((n) => rosterByNormalized.get(n))
                            .filter((a): a is AgentRosterEntry => a !== undefined);

                        const otherDesc = otherAgents
                            .map((a) => `${a.name} (${a.description || "team member"})`)
                            .join(", ");

                        messages.push(new HumanMessage(
                            `[CONTEXT: You (${thisAgent?.name}) are responding simultaneously with: ${otherDesc}. ` +
                            `They are handling their parts of this request RIGHT NOW. ` +
                            `Do NOT hand off, delegate to, or @mention them. Focus ONLY on YOUR part of the request.]`,
                        ));
                    }

                    return new Send(`agent_${name}`, { messages });
                });
            };

            // Build graph
            const graphBuilder = new StateGraph(SwarmState)
                .addNode("broadcast", broadcastNode)
                .addNode("collector", collectorNode);

            for (const entry of roster) {
                const nodeName = `agent_${entry.normalizedName}`;
                // Add compiled subgraph directly (not wrapped) so streamEvents propagates through
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                graphBuilder.addNode(nodeName, agentSubgraphs.get(entry.normalizedName)! as any);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                graphBuilder.addEdge(nodeName as any, "collector");
            }

            graphBuilder.addEdge(START, "broadcast");
            graphBuilder.addConditionalEdges("broadcast", broadcastEdge);
            graphBuilder.addEdge("collector", "broadcast");

            const graph = graphBuilder.compile();
            logger.info({ nodeCount: roster.length + 2 }, "Swarm graph compiled");

            // 5. Stream using messages + updates modes
            const resolveAgent = (node: string | undefined): AgentRosterEntry | undefined => {
                if (!node) return undefined;
                for (const entry of roster) {
                    const prefix = `agent_${entry.normalizedName}`;
                    if (node === prefix || node.startsWith(`${prefix}.`) || node.startsWith(`${prefix}:`)) {
                        return entry;
                    }
                }
                for (const entry of roster) {
                    if (node.includes(entry.normalizedName)) {
                        return entry;
                    }
                }
                return undefined;
            };

            const stream = await graph.stream(
                {
                    messages: baseMessages,
                    maxRounds,
                },
                { streamMode: ["messages", "updates"], recursionLimit: 100 },
            );

            let currentRoundForEvents = 0;

            // Per-round SKIP filtering state
            const SKIP_BUFFER_THRESHOLD = 10;
            const agentBuffers = new Map<string, string>();
            const skippedAgents = new Set<string>();
            const flushedAgents = new Set<string>();
            const startedAgents = new Set<string>();

            // Generator that flushes an agent's buffer and yields events
            function* flushAgentBuffer(
                agentId: string,
                rosterEntry: AgentRosterEntry,
            ): Generator<SwarmStreamEvent> {
                const buffered = agentBuffers.get(agentId) || "";
                agentBuffers.delete(agentId);

                if (buffered.trim() === "[SKIP]") {
                    skippedAgents.add(agentId);
                    return;
                }

                flushedAgents.add(agentId);

                if (!startedAgents.has(agentId)) {
                    startedAgents.add(agentId);
                    yield {
                        type: "agent_turn_start",
                        agentId: rosterEntry.id,
                        agentName: rosterEntry.name,
                    };
                }

                if (buffered) {
                    yield {
                        type: "token",
                        content: buffered,
                        agentId: rosterEntry.id,
                        agentName: rosterEntry.name,
                    };
                }
            }

            logger.info("Swarm stream started, entering event loop");

            for await (const chunk of stream) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawChunk = chunk as any;
                const [mode, payload] = Array.isArray(rawChunk) ? rawChunk : [undefined, rawChunk];

                if (mode === "messages") {
                    const [msg, meta] = payload as [BaseMessage, Record<string, unknown>];
                    logger.debug({
                        mode,
                        msgType: msg?.constructor?.name,
                        langgraphNode: meta?.langgraph_node,
                        checkpointNs: meta?.langgraph_checkpoint_ns,
                        contentPreview: typeof msg?.content === "string" ? msg.content.slice(0, 80) : undefined,
                    }, "Swarm messages chunk");
                } else if (mode === "updates") {
                    const keys = payload ? Object.keys(payload as object) : [];
                    logger.debug({ mode, updateKeys: keys }, "Swarm updates chunk");
                } else {
                    logger.debug({ mode, rawType: typeof rawChunk, isArray: Array.isArray(rawChunk) }, "Swarm unknown chunk format");
                }

                if (mode === "messages") {
                    const [message, metadata] = payload as [BaseMessage, Record<string, string>];
                    const activeNode = metadata?.langgraph_node;
                    let agentEntry = resolveAgent(activeNode);
                    if (!agentEntry) {
                        agentEntry = resolveAgent(metadata?.langgraph_checkpoint_ns);
                    }
                    if (!agentEntry) continue;

                    const agentId = agentEntry.id;

                    if (message instanceof AIMessageChunk) {
                        const content = extractTextFromContent(message.content);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const toolCallChunks = (message as any).tool_call_chunks;
                        const hasToolCall = Array.isArray(toolCallChunks) && toolCallChunks.some((tc: Record<string, unknown>) => tc.name);

                        // Tool call immediately flushes the buffer (tool call = definitely not a skip)
                        if (hasToolCall && !flushedAgents.has(agentId)) {
                            yield* flushAgentBuffer(agentId, agentEntry);
                        }

                        if (content) {
                            // If agent is already confirmed skipped, suppress
                            if (skippedAgents.has(agentId)) continue;

                            // If agent is already flushed, stream directly
                            if (flushedAgents.has(agentId)) {
                                if (!startedAgents.has(agentId)) {
                                    startedAgents.add(agentId);
                                    yield {
                                        type: "agent_turn_start",
                                        agentId: agentEntry.id,
                                        agentName: agentEntry.name,
                                    };
                                }
                                yield {
                                    type: "token",
                                    content,
                                    agentId: agentEntry.id,
                                    agentName: agentEntry.name,
                                };
                            } else {
                                // Buffer phase: accumulate until threshold
                                const currentBuffer = (agentBuffers.get(agentId) || "") + content;
                                agentBuffers.set(agentId, currentBuffer);

                                if (currentBuffer.length >= SKIP_BUFFER_THRESHOLD) {
                                    // Enough chars to decide — flush
                                    yield* flushAgentBuffer(agentId, agentEntry);
                                }
                            }
                        }

                        // Handle tool call chunks (only if not skipped)
                        if (Array.isArray(toolCallChunks) && !skippedAgents.has(agentId)) {
                            for (const tc of toolCallChunks) {
                                if (tc.name) {
                                    if (!startedAgents.has(agentId)) {
                                        startedAgents.add(agentId);
                                        yield {
                                            type: "agent_turn_start",
                                            agentId: agentEntry.id,
                                            agentName: agentEntry.name,
                                        };
                                    }
                                    yield {
                                        type: "tool_call_start",
                                        toolName: tc.name,
                                        toolArgs: tc.args,
                                        toolCallId: tc.id,
                                        agentId: agentEntry.id,
                                        agentName: agentEntry.name,
                                    };
                                }
                            }
                        }

                        const msgMeta = (message as unknown as { response_metadata?: { tokenUsage?: Record<string, number | undefined>; usage?: Record<string, number | undefined>; prompt_eval_count?: number; eval_count?: number } }).response_metadata;
                        const msgUsage = (message.usage_metadata || msgMeta?.tokenUsage || msgMeta?.usage) as Record<string, number | undefined> | undefined;
                        const pTokens = msgUsage?.input_tokens ?? msgUsage?.prompt_tokens ?? msgUsage?.promptTokens ?? msgMeta?.prompt_eval_count ?? 0;
                        const cTokens = msgUsage?.output_tokens ?? msgUsage?.completion_tokens ?? msgUsage?.completionTokens ?? msgMeta?.eval_count ?? 0;
                        const tTokens = msgUsage?.total_tokens ?? msgUsage?.totalTokens ?? (pTokens + cTokens);
                        if (tTokens > 0) {
                            yield {
                                type: "token_usage",
                                promptTokens: pTokens,
                                completionTokens: cTokens,
                                totalTokens: tTokens,
                                agentId: agentEntry.id,
                                agentName: agentEntry.name,
                            };
                        }
                    } else if (message instanceof ToolMessage) {
                        if (skippedAgents.has(agentId)) continue;

                        yield {
                            type: "tool_result",
                            toolName: message.name,
                            toolResult: typeof message.content === "string"
                                ? message.content
                                : JSON.stringify(message.content),
                            toolCallId: message.tool_call_id,
                            agentId: agentEntry.id,
                            agentName: agentEntry.name,
                        };
                    }
                } else if (mode === "updates") {
                    const updates = payload as Record<string, Record<string, unknown>>;
                    for (const [nodeName, output] of Object.entries(updates)) {
                        if (nodeName === "broadcast") {
                            if (output.roundCount) {
                                currentRoundForEvents = output.roundCount as number;
                            }
                            const activeAgents = output.activeAgents as string[] | undefined;
                            if (activeAgents && activeAgents.length > 0) {
                                // Clear per-round state
                                agentBuffers.clear();
                                skippedAgents.clear();
                                flushedAgents.clear();
                                startedAgents.clear();

                                yield {
                                    type: "round_start",
                                    round: currentRoundForEvents,
                                };
                                const routedNames = activeAgents.map(
                                    (n) => rosterByNormalized.get(n)?.name ?? n,
                                );
                                yield {
                                    type: "routing",
                                    round: currentRoundForEvents,
                                    routedAgents: routedNames,
                                    routingReason: currentRoundForEvents === 1 ? "llm_fallback" : "mention",
                                };
                            }
                        } else if (nodeName === "collector") {
                            // Flush any remaining unflushed agent buffers
                            for (const entry of roster) {
                                if (agentBuffers.has(entry.id) && !flushedAgents.has(entry.id) && !skippedAgents.has(entry.id)) {
                                    yield* flushAgentBuffer(entry.id, entry);
                                }
                            }

                            // Emit agent_turn_end for each started agent that isn't skipped
                            for (const agentId of startedAgents) {
                                if (skippedAgents.has(agentId)) continue;
                                const entry = roster.find((r) => r.id === agentId);
                                if (entry) {
                                    yield {
                                        type: "agent_turn_end",
                                        agentId: entry.id,
                                        agentName: entry.name,
                                    };
                                }
                            }
                            startedAgents.clear();
                            yield {
                                type: "round_end",
                                round: currentRoundForEvents,
                            };
                        }
                    }
                }
            }

            yield { type: "done" };
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            const errStack = error instanceof Error ? error.stack : undefined;
            logger.error({ err: error, errMsg, errStack }, "Swarm service error");
            yield {
                type: "error",
                error: errMsg,
            };
        }
    }
}

export const swarmAgentService = new SwarmAgentService();
