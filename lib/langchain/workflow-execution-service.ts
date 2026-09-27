import "server-only";
import { logger } from "@/lib/logger";
/**
 * Advanced Workflow Execution Service using DAG scheduling
 *
 * Executes workflow steps as a directed acyclic graph (DAG):
 * - parallel execution for independent branches
 * - dependency-aware scheduling for downstream nodes
 * - real-time streaming events for UI updates
 *
 * Each step is treated as a graph node and connected through `nextSteps`.
 * All steps are agent steps — tool nodes have been removed.
 */

import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
} from "@langchain/core/messages";
import {
    Agent,
    WorkflowStep,
    MCPServerConfig,
    WorkflowExecutionStep,
    ToolCall,
    WorkflowExecutionStreamEvent,
} from "../types";
import { createMCPClient } from "./langchain-mcp";
import { StructuredToolInterface } from "@langchain/core/tools";
import { WorkflowStore } from "../mongodb/workflow-store";
import { isDatabaseConfigured } from "../mongodb/client";
import { getDefaultModel, getModel } from "./model-factory";
import { DEFAULT_MODEL_ID } from "./model-config";
import { extractTextFromContent } from "./langchain-message-utils";
import {
    NodeKind,
    LLMNodeData,
    HttpNodeData,
    ConditionNodeData,
    TemplateNodeData,
    TipTapMentionJsonContent,
    OutputSchemaSourceKey,
    HttpValue,
} from "@/lib/workflow/types";
import { ConditionBranch } from "@/lib/workflow/condition";
import { RichWorkflow } from "@/lib/types";

export interface RichWorkflowStreamEvent {
    eventType: "WORKFLOW_START" | "WORKFLOW_END" | "NODE_START" | "NODE_END";
    nodeId?: string;
    nodeExecutionId?: string;
    node?: { name: string };
    isOk?: boolean;
    output?: unknown;
    input?: unknown;
    error?: string;
    tokens?: { prompt: number; completion: number };
    executionId?: string;
}

// Define the state that flows through the graph
interface WorkflowState {
    messages: BaseMessage[];
    currentInput: string;
    currentStepIndex: number;
    stepResults: Array<{
        stepIndex: number;
        stepName: string;
        agentId: string;
        agentName: string;
        output: string;
        toolCalls: ToolCall[];
        duration?: number;
    }>;
    initialInput: string;
    error?: string;
}

export class WorkflowExecutionService {
    /**
     * Get MCP tools for a specific agent
     */
    private async getMCPTools(
        mcpServers: MCPServerConfig[],
        allowedTools?: string[]
    ): Promise<StructuredToolInterface[]> {
        if (!allowedTools || allowedTools.length === 0) {
            return [];
        }

        if (!mcpServers || mcpServers.length === 0) {
            return [];
        }

        const mcpClient = createMCPClient(mcpServers);
        if (!mcpClient) return [];

        try {
            const allTools = await mcpClient.getTools();
            return allTools.filter(t => {
                return allowedTools.some(allowed => {
                    if (allowed.includes(":")) {
                        const [serverName, toolName] = allowed.split(":", 2);
                        return t.name === toolName ||
                            t.name === `${serverName}_${toolName}` ||
                            t.name === allowed;
                    }

                    return t.name === allowed || t.name.endsWith(`_${allowed}`);
                });
            });
        } catch (error) {
            logger.warn("Failed to load MCP tools:", error);
            return [];
        }
    }

    /**
     * Create the final synthesizer node that consolidates all agent outputs
     */
    private createFinalSynthesizerNode(params: {
        eventEmitter: (event: WorkflowExecutionStreamEvent) => void;
    }) {
        const { eventEmitter } = params;

        return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
            const startTime = Date.now();

            logger.info('[Synthesizer] Starting synthesis with', state.stepResults.length, 'agent results');

            eventEmitter({
                type: "step_start",
                stepId: "__final_synthesizer__",
                stepIndex: state.stepResults.length,
                stepName: "Final Synthesis",
                agentId: "synthesizer",
                agentName: "Final Synthesizer",
            });

            try {
                const model = getDefaultModel();

                // Build the synthesis prompt with all agent outputs
                const agentContributions = state.stepResults.map((result, index) =>
                    `## Phase ${index + 1}: ${result.stepName} (${result.agentName})\n\n${result.output}`
                ).join("\n\n---\n\n");

                const synthesisPrompt = `You are a document synthesis engine. Your ONLY job is to merge multiple agent outputs into ONE unified document.

## STRICT OUTPUT FORMAT - YOU MUST FOLLOW THIS EXACTLY:

Your response MUST start with this exact structure:

# Executive Summary
[2-3 sentence overview of the complete deliverable]

# Detailed Deliverable
[Merged content from all agents, organized logically]

---

## INPUT DATA:

### Original User Request:
${state.initialInput}

### Agent Outputs to Merge:
${agentContributions}

---

## ABSOLUTE RULES (VIOLATION = FAILURE):
1. NEVER start with "As the..." or "I am..." or any role introduction
2. NEVER mention agent names, roles, or personas in the output
3. NEVER write in first person from any agent's perspective
4. ALWAYS start your response with "# Executive Summary"
5. Merge and synthesize - do NOT just copy-paste agent outputs
6. Write in neutral, professional tone as if from a unified team

BEGIN YOUR RESPONSE WITH "# Executive Summary" - NO OTHER OPENING IS ACCEPTABLE.`;

                const messages: BaseMessage[] = [
                    new SystemMessage(synthesisPrompt),
                    new HumanMessage("Please synthesize the agent contributions into a unified final deliverable. Begin with # Executive Summary."),
                ];

                eventEmitter({
                    type: "step_thinking",
                    stepId: "__final_synthesizer__",
                    stepIndex: state.stepResults.length,
                    stepName: "Final Synthesis",
                    agentId: "synthesizer",
                    agentName: "Final Synthesizer",
                    content: "Consolidating all agent outputs into final draft...",
                });

                // Stream the synthesis
                let finalDraft = "";
                let finalChunk: AIMessageChunk | null = null;
                let emittedContent = false;

                const stream = await model.stream(messages);

                for await (const chunk of stream) {
                    finalChunk = finalChunk ? finalChunk.concat(chunk) : chunk;
                    const content = extractTextFromContent(chunk.content);
                    if (content) {
                        emittedContent = true;
                        finalDraft += content;
                        eventEmitter({
                            type: "step_token",
                            stepId: "__final_synthesizer__",
                            stepIndex: state.stepResults.length,
                            stepName: "Final Synthesis",
                            agentId: "synthesizer",
                            agentName: "Final Synthesizer",
                            content,
                        });
                    }
                }

                if (!emittedContent && finalChunk) {
                    const fallbackContent = extractTextFromContent(finalChunk.content);
                    if (fallbackContent) {
                        finalDraft += fallbackContent;
                        eventEmitter({
                            type: "step_token",
                            stepId: "__final_synthesizer__",
                            stepIndex: state.stepResults.length,
                            stepName: "Final Synthesis",
                            agentId: "synthesizer",
                            agentName: "Final Synthesizer",
                            content: fallbackContent,
                        });
                    }
                }

                const duration = Math.round((Date.now() - startTime) / 1000);
                const synthUsage = finalChunk?.usage_metadata;
                const synthTokens = synthUsage
                    ? { prompt: synthUsage.input_tokens ?? 0, completion: synthUsage.output_tokens ?? 0 }
                    : undefined;

                eventEmitter({
                    type: "step_complete",
                    stepId: "__final_synthesizer__",
                    stepIndex: state.stepResults.length,
                    stepName: "Final Synthesis",
                    agentId: "synthesizer",
                    agentName: "Final Synthesizer",
                    result: finalDraft,
                    duration,
                    tokens: synthTokens,
                });

                return {
                    currentInput: finalDraft,
                    stepResults: [
                        ...state.stepResults,
                        {
                            stepIndex: state.stepResults.length,
                            stepName: "Final Synthesis",
                            agentId: "synthesizer",
                            agentName: "Final Synthesizer",
                            output: finalDraft,
                            toolCalls: [],
                            duration,
                        },
                    ],
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : "Unknown error";
                logger.error('[Synthesizer] Error during synthesis:', errorMsg, error);
                eventEmitter({
                    type: "step_error",
                    stepId: "__final_synthesizer__",
                    stepIndex: state.stepResults.length,
                    stepName: "Final Synthesis",
                    agentId: "synthesizer",
                    agentName: "Final Synthesizer",
                    error: errorMsg,
                });

                // On error, just return the last agent's output
                return {};
            }
        };
    }

    /**
     * Create an agent node function for the graph
     */
    private createAgentNode(params: {
        step: WorkflowStep;
        agent: Agent;
        mcpServers: MCPServerConfig[];
        stepId: string;
        stepIndex: number;
        eventEmitter: (event: WorkflowExecutionStreamEvent) => void;
    }) {
        const { step, agent, mcpServers, stepId, stepIndex, eventEmitter } = params;

        return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
            const startTime = Date.now();

            eventEmitter({
                type: "step_start",
                stepId,
                stepIndex,
                stepName: step.name,
                agentId: agent.id,
                agentName: agent.name,
            });

            try {
                // Get agent's tools
                const tools = await this.getMCPTools(mcpServers, agent.tools);

                // Create the model with tools
                const model = getModel(agent.modelId || DEFAULT_MODEL_ID);
                const modelWithTools = tools.length > 0 && model.bindTools
                    ? model.bindTools(tools)
                    : model;

                // Build system prompt
                const systemPrompt = step.input
                    ? `${agent.systemPrompt || `You are ${agent.name}. ${agent.description}`}\n\n## Current Task:\n${step.input}`
                    : agent.systemPrompt || `You are ${agent.name}. ${agent.description}`;

                // Prepare messages
                const messages: BaseMessage[] = [
                    new SystemMessage(systemPrompt),
                    ...state.messages,
                    new HumanMessage(state.currentInput),
                ];

                eventEmitter({
                    type: "step_thinking",
                    stepId,
                    stepIndex,
                    stepName: step.name,
                    agentId: agent.id,
                    agentName: agent.name,
                    content: "Processing...",
                });

                // Stream the agent execution
                let fullResponse = "";
                const toolCalls: ToolCall[] = [];
                const emittedToolCallIds = new Set<string>();
                let finalChunk: AIMessageChunk | null = null;
                let emittedContent = false;

                const stream = await modelWithTools.stream(messages);

                for await (const chunk of stream) {
                    finalChunk = finalChunk ? finalChunk.concat(chunk) : chunk;
                    // Handle content tokens
                    const content = extractTextFromContent(chunk.content);
                    if (content) {
                        emittedContent = true;
                        fullResponse += content;
                        eventEmitter({
                            type: "step_token",
                            stepId,
                            stepIndex,
                            stepName: step.name,
                            agentId: agent.id,
                            agentName: agent.name,
                            content,
                        });
                    }

                    // Handle tool calls
                    if (chunk.tool_calls && Array.isArray(chunk.tool_calls)) {
                        for (const toolCall of chunk.tool_calls) {
                            if (toolCall.id && !emittedToolCallIds.has(toolCall.id)) {
                                emittedToolCallIds.add(toolCall.id);

                                toolCalls.push({
                                    id: toolCall.id,
                                    name: toolCall.name,
                                    arguments: toolCall.args,
                                });

                                eventEmitter({
                                    type: "tool_call_start",
                                    stepId,
                                    stepIndex,
                                    stepName: step.name,
                                    agentId: agent.id,
                                    agentName: agent.name,
                                    toolName: toolCall.name,
                                    toolArgs: toolCall.args || {},
                                    toolCallId: toolCall.id,
                                });
                            }
                        }
                    }
                }

                if (!emittedContent && finalChunk) {
                    const fallbackContent = extractTextFromContent(finalChunk.content);
                    if (fallbackContent) {
                        fullResponse += fallbackContent;
                        eventEmitter({
                            type: "step_token",
                            stepId,
                            stepIndex,
                            stepName: step.name,
                            agentId: agent.id,
                            agentName: agent.name,
                            content: fallbackContent,
                        });
                    }
                }

                // Execute tool calls if any
                if (toolCalls.length > 0 && tools.length > 0) {
                    for (const toolCall of toolCalls) {
                        const tool = tools.find(t => t.name === toolCall.name);
                        if (tool) {
                            try {
                                const result = await tool.invoke(toolCall.arguments);
                                const resultStr = typeof result === "string"
                                    ? result
                                    : JSON.stringify(result, null, 2);

                                toolCall.result = resultStr;

                                eventEmitter({
                                    type: "tool_result",
                                    stepId,
                                    stepIndex,
                                    stepName: step.name,
                                    agentId: agent.id,
                                    agentName: agent.name,
                                    toolResult: resultStr,
                                    toolCallId: toolCall.id,
                                });

                                // Add tool result to response
                                fullResponse += `\n\n[Tool ${toolCall.name} executed successfully]`;
                            } catch (error) {
                                const errorMsg = error instanceof Error ? error.message : "Unknown error";
                                toolCall.result = `Error: ${errorMsg}`;
                                eventEmitter({
                                    type: "tool_result",
                                    stepId,
                                    stepIndex,
                                    stepName: step.name,
                                    agentId: agent.id,
                                    agentName: agent.name,
                                    toolResult: `Error: ${errorMsg}`,
                                    toolCallId: toolCall.id,
                                });
                            }
                        }
                    }
                }

                const duration = Math.round((Date.now() - startTime) / 1000);
                const usageMeta = finalChunk?.usage_metadata;
                const tokens = usageMeta
                    ? { prompt: usageMeta.input_tokens ?? 0, completion: usageMeta.output_tokens ?? 0 }
                    : undefined;

                eventEmitter({
                    type: "step_complete",
                    stepId,
                    stepIndex,
                    stepName: step.name,
                    agentId: agent.id,
                    agentName: agent.name,
                    result: fullResponse,
                    duration,
                    tokens,
                });

                // Update state for next agent
                return {
                    currentInput: fullResponse,
                    currentStepIndex: stepIndex + 1,
                    stepResults: [
                        ...state.stepResults,
                        {
                            stepIndex,
                            stepName: step.name,
                            agentId: agent.id,
                            agentName: agent.name,
                            output: fullResponse,
                            toolCalls,
                            duration,
                        },
                    ],
                    messages: [
                        new HumanMessage(state.currentInput),
                        new AIMessage(`${agent.name} response: ${fullResponse}`),
                    ],
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : "Unknown error";
                eventEmitter({
                    type: "step_error",
                    stepId,
                    stepIndex,
                    stepName: step.name,
                    agentId: agent.id,
                    agentName: agent.name,
                    error: errorMsg,
                });

                return {
                    error: errorMsg,
                };
            }
        };
    }

    /**
     * Execute a complete workflow as a dependency graph (DAG).
     */
    async *executeWorkflow(params: {
        workflowId: string;
        workflowName: string;
        userId: string;
        userName?: string;
        userEmail?: string;
        steps: WorkflowStep[];
        agents: Map<string, Agent>;
        initialMessage: string;
        mcpServers: MCPServerConfig[];
    }): AsyncGenerator<WorkflowExecutionStreamEvent, void, unknown> {
        const {
            workflowId,
            workflowName,
            userId,
            userName = "",
            userEmail = "",
            steps,
            agents,
            initialMessage,
            mcpServers,
        } = params;
        const normalizedSteps = steps.map((step, index) => ({
            ...step,
            id: step.id || `step_${index}`,
        }));
        const executionStartMs = Date.now();

        // Initialize store
        const store = isDatabaseConfigured() ? new WorkflowStore() : null;
        let executionId: string | undefined;

        // Event emitter for streaming
        const events: WorkflowExecutionStreamEvent[] = [];
        const eventEmitter = (event: WorkflowExecutionStreamEvent) => {
            events.push(event);
        };

        // Create execution record and keep a mutable in-memory mirror
        const executionSteps: WorkflowExecutionStep[] = normalizedSteps.map((s) => {
            return {
                stepId: s.id,
                stepName: s.name,
                agentId: s.agentId,
                agentName: agents.get(s.agentId)?.name,
                status: 'pending',
                startTime: undefined,
                endTime: undefined,
                input: undefined,
                output: undefined,
                toolCalls: []
            };
        });
        const stepIndexById = new Map<string, number>();
        executionSteps.forEach((step, index) => {
            stepIndexById.set(step.stepId, index);
        });
        let currentStepIndex = 0;

        if (store) {
            try {
                const execution = await store.createExecution({
                    workflowId,
                    userId,
                    userName,
                    userEmail,
                    title: workflowName,
                    status: 'running',
                    startTime: new Date().toISOString(),
                    steps: executionSteps,
                    currentStepIndex,
                    initialInput: initialMessage
                });
                executionId = execution.id;
            } catch (error) {
                logger.error("Failed to create execution record:", error);
            }
        }

        yield {
            type: "workflow_start",
            workflowId,
            content: `Starting workflow: ${workflowName}`,
            finalResult: executionId,
        };

        try {
            const persistExecutionProgress = async () => {
                if (!executionId || !store) return;
                await store.updateExecution(executionId, workflowId, {
                    currentStepIndex,
                    steps: executionSteps,
                });
            };

            const applyEventToExecution = (event: WorkflowExecutionStreamEvent) => {
                let stepIdx: number | undefined;
                if (event.stepId) {
                    stepIdx = stepIndexById.get(event.stepId);
                } else if (typeof event.stepIndex === "number") {
                    stepIdx = event.stepIndex;
                }

                if (typeof stepIdx !== "number") return;
                const step = executionSteps[stepIdx];
                if (!step) return;

                if (event.type === "step_start") {
                    step.status = "running";
                    step.startTime = step.startTime || new Date().toISOString();
                    currentStepIndex = stepIdx;
                    return;
                }

                if (event.type === "tool_call_start") {
                    if (event.toolName) {
                        step.toolCalls = [
                            ...(step.toolCalls || []),
                            {
                                id: event.toolCallId || `${step.stepId}_${Date.now()}`,
                                name: event.toolName,
                                arguments: event.toolArgs || {},
                            },
                        ];
                    }
                    return;
                }

                if (event.type === "tool_result") {
                    if (event.toolCallId && step.toolCalls?.length) {
                        const toolCall = step.toolCalls.find((t) => t.id === event.toolCallId);
                        if (toolCall) {
                            toolCall.result = event.toolResult;
                        }
                    }
                    return;
                }

                if (event.type === "step_complete") {
                    step.status = "completed";
                    step.endTime = new Date().toISOString();
                    step.output = event.result || step.output;
                    step.duration = event.duration ?? step.duration;
                    step.tokens = event.tokens ?? step.tokens;
                    step.error = undefined;
                    return;
                }

                if (event.type === "step_error") {
                    step.status = "error";
                    step.endTime = new Date().toISOString();
                    step.error = event.error || "Unknown step error";
                }
            };

            const resolveStepInput = (
                step: WorkflowStep,
                parentContext: Array<{ stepName: string; output: string }>,
            ) => {
                const configuredInput = step.input?.trim() || undefined;

                if (configuredInput && parentContext.length === 0) return configuredInput;
                if (configuredInput && parentContext.length > 0) {
                    const mergedContext = parentContext
                        .map((p, i) => `### Parent ${i + 1}: ${p.stepName}\n${p.output}`)
                        .join("\n\n");
                    return `${configuredInput}\n\n## Context From Previous Steps\n${mergedContext}`;
                }
                if (parentContext.length > 0) {
                    return parentContext
                        .map((p, i) => `### Parent ${i + 1}: ${p.stepName}\n${p.output}`)
                        .join("\n\n");
                }
                return initialMessage;
            };

            let finalResult = "Workflow completed with no output.";
            let completedStepCount = 0;
            let graphRunError: Error | undefined;
            let graphRunFinished = false;

            const runGraphPromise = (async () => {
                const stepById = new Map<string, WorkflowStep>();
                const parentIdsByStep = new Map<string, string[]>();
                const childIdsByStep = new Map<string, string[]>();
                const remainingParentCount = new Map<string, number>();
                const stepOutputs = new Map<string, string>();
                const launchedSteps = new Set<string>();

                normalizedSteps.forEach((step) => {
                    stepById.set(step.id, step);
                    parentIdsByStep.set(step.id, []);
                    childIdsByStep.set(step.id, []);
                });

                normalizedSteps.forEach((step) => {
                    (step.nextSteps || []).forEach((nextId) => {
                        if (!stepById.has(nextId)) {
                            logger.warn(`[WorkflowExecution] Ignoring missing step edge ${step.id} -> ${nextId}`);
                            return;
                        }
                        childIdsByStep.get(step.id)?.push(nextId);
                        parentIdsByStep.get(nextId)?.push(step.id);
                    });
                });

                normalizedSteps.forEach((step) => {
                    remainingParentCount.set(step.id, parentIdsByStep.get(step.id)?.length || 0);
                });

                let runningCount = 0;
                let firstStepError: Error | undefined;
                let resolveAllDone: (() => void) | undefined;
                const allDone = new Promise<void>((resolve) => {
                    resolveAllDone = resolve;
                });

                const maybeResolveAllDone = () => {
                    if (runningCount === 0 && resolveAllDone) resolveAllDone();
                };

                const launchStep = (stepId: string) => {
                    if (launchedSteps.has(stepId) || firstStepError) return;
                    const step = stepById.get(stepId);
                    if (!step) return;
                    const stepIndex = stepIndexById.get(stepId) ?? 0;
                    const agent = agents.get(step.agentId);
                    if (!agent) {
                        firstStepError = new Error(`Agent not found: ${step.agentId}`);
                        return;
                    }

                    launchedSteps.add(stepId);
                    runningCount += 1;

                    const parentContext = (parentIdsByStep.get(stepId) || [])
                        .map((parentId) => {
                            const parentStep = stepById.get(parentId);
                            const parentOutput = stepOutputs.get(parentId);
                            if (!parentStep || !parentOutput) return null;
                            return { stepName: parentStep.name, output: parentOutput };
                        })
                        .filter((item): item is { stepName: string; output: string } => item !== null);

                    const runtimeInput = resolveStepInput(step, parentContext);
                    executionSteps[stepIndex].input = runtimeInput;

                    const executeNode = this.createAgentNode({
                        step,
                        agent,
                        mcpServers,
                        stepId,
                        stepIndex,
                        eventEmitter,
                    });

                    const stepState: WorkflowState = {
                        messages: [],
                        currentInput: runtimeInput,
                        currentStepIndex: stepIndex,
                        stepResults: [],
                        initialInput: initialMessage,
                    };

                    void executeNode(stepState)
                        .then((nodeResult) => {
                            if (nodeResult.error) {
                                throw new Error(nodeResult.error);
                            }
                            const output = typeof nodeResult.currentInput === "string"
                                ? nodeResult.currentInput
                                : "";
                            stepOutputs.set(stepId, output);
                            completedStepCount += 1;

                            if (!firstStepError) {
                                (childIdsByStep.get(stepId) || []).forEach((childId) => {
                                    const pending = (remainingParentCount.get(childId) || 0) - 1;
                                    remainingParentCount.set(childId, pending);
                                    if (pending <= 0) launchStep(childId);
                                });
                            }
                        })
                        .catch((error) => {
                            if (!firstStepError) {
                                firstStepError = error instanceof Error ? error : new Error(String(error));
                            }
                        })
                        .finally(() => {
                            runningCount -= 1;
                            maybeResolveAllDone();
                        });
                };

                const startStepIds = normalizedSteps
                    .filter((step) => (parentIdsByStep.get(step.id)?.length || 0) === 0)
                    .map((step) => step.id);

                if (startStepIds.length === 0) {
                    throw new Error("Workflow graph has no start node. Check for circular dependencies.");
                }

                startStepIds.forEach((stepId) => launchStep(stepId));
                maybeResolveAllDone();
                await allDone;

                if (firstStepError) throw firstStepError;
                if (launchedSteps.size !== normalizedSteps.length) {
                    const unresolved = normalizedSteps
                        .filter((step) => !launchedSteps.has(step.id))
                        .map((step) => step.name)
                        .join(", ");
                    throw new Error(`Workflow graph could not execute all steps: ${unresolved}`);
                }

                const synthesisStepResults = normalizedSteps
                    .map((step, index) => {
                        const output = stepOutputs.get(step.id) || "";
                        if (!output.trim()) return null;
                        return {
                            stepIndex: index,
                            stepName: step.name,
                            agentId: step.agentId,
                            agentName: agents.get(step.agentId)?.name || "Unknown Agent",
                            output,
                            toolCalls: executionSteps[index]?.toolCalls || [],
                            duration: executionSteps[index]?.duration,
                        };
                    })
                    .filter((item): item is NonNullable<typeof item> => item !== null);

                if (synthesisStepResults.length === 0) {
                    finalResult = "Workflow completed with no output.";
                    return;
                }

                const fallbackMergedOutput = synthesisStepResults
                    .map((result, index) => `## Step ${index + 1}: ${result.stepName}\n\n${result.output}`)
                    .join("\n\n---\n\n");

                const synthesize = this.createFinalSynthesizerNode({ eventEmitter });
                const synthesisState: WorkflowState = {
                    messages: [],
                    currentInput: fallbackMergedOutput,
                    currentStepIndex: normalizedSteps.length,
                    stepResults: synthesisStepResults,
                    initialInput: initialMessage,
                };
                const synthesisResult = await synthesize(synthesisState);
                const synthesized = typeof synthesisResult.currentInput === "string"
                    ? synthesisResult.currentInput.trim()
                    : "";
                finalResult = synthesized || fallbackMergedOutput;
            })()
                .catch((error) => {
                    graphRunError = error instanceof Error ? error : new Error(String(error));
                })
                .finally(() => {
                    graphRunFinished = true;
                });

            let eventIndex = 0;
            while (!graphRunFinished || eventIndex < events.length) {
                while (eventIndex < events.length) {
                    const event = events[eventIndex];
                    applyEventToExecution(event);
                    if (
                        event.type === "step_start" ||
                        event.type === "step_complete" ||
                        event.type === "step_error" ||
                        event.type === "tool_call_start" ||
                        event.type === "tool_result"
                    ) {
                        await persistExecutionProgress();
                    }
                    yield event;
                    eventIndex++;
                }

                if (!graphRunFinished) {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                }
            }

            await runGraphPromise;
            if (graphRunError) throw graphRunError;

            logger.info('[WorkflowExecution] Total events:', events.length);
            logger.info('[WorkflowExecution] DAG execution completed');

            const runDuration = Math.round((Date.now() - executionStartMs) / 1000);

            // Update execution
            if (executionId && store) {
                const aggTokens = executionSteps.reduce(
                    (acc, s) => {
                        if (s.tokens) { acc.prompt += s.tokens.prompt; acc.completion += s.tokens.completion; }
                        return acc;
                    },
                    { prompt: 0, completion: 0 },
                );
                await store.updateExecution(executionId, workflowId, {
                    status: 'completed',
                    endTime: new Date().toISOString(),
                    duration: runDuration,
                    finalOutput: finalResult,
                    currentStepIndex,
                    steps: executionSteps,
                    tokenUsage: aggTokens.prompt + aggTokens.completion > 0
                        ? { ...aggTokens, total: aggTokens.prompt + aggTokens.completion }
                        : undefined,
                });
            }

            yield {
                type: "workflow_complete",
                workflowId,
                finalResult,
                content: `Workflow completed successfully. ${completedStepCount} steps executed.`,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            const runDuration = Math.round((Date.now() - executionStartMs) / 1000);

            if (executionId && store) {
                await store.updateExecution(executionId, workflowId, {
                    status: 'error',
                    endTime: new Date().toISOString(),
                    duration: runDuration,
                    currentStepIndex,
                    steps: executionSteps,
                    error: errorMsg
                });
            }

            yield {
                type: "workflow_error",
                workflowId,
                error: errorMsg,
            };
        }
    }

    // =========================================================================
    // Rich Workflow (node-based) execution — new methods below
    // =========================================================================

    /**
     * Resolve an HttpValue (string or OutputSchemaSourceKey) to a concrete string
     * by looking up previous node outputs.
     */
    private resolveValue(
        value: HttpValue | undefined,
        nodeOutputs: Map<string, unknown>,
    ): string {
        if (!value) return "";
        if (typeof value === "string") return value;
        // It's an OutputSchemaSourceKey
        const nodeOutput = nodeOutputs.get(value.nodeId);
        if (nodeOutput === undefined || nodeOutput === null) return "";
        let result: unknown = nodeOutput;
        for (const segment of value.path) {
            if (result && typeof result === "object" && segment in result) {
                result = (result as Record<string, unknown>)[segment];
            } else {
                return "";
            }
        }
        return typeof result === "string" ? result : JSON.stringify(result);
    }

    /**
     * Resolve TipTap mention-rich content to plain text, substituting mention
     * references with resolved values from previous node outputs.
     */
    private resolveTipTapContent(
        content: TipTapMentionJsonContent | undefined,
        nodeOutputs: Map<string, unknown>,
    ): string {
        if (!content?.content) return "";
        const parts: string[] = [];
        for (const block of content.content) {
            if (!block.content) {
                parts.push("");
                continue;
            }
            for (const inline of block.content) {
                if (inline.type === "text" && inline.text) {
                    parts.push(inline.text);
                } else if (inline.type === "mention" && inline.attrs) {
                    // attrs.id is "nodeId.path.segments" format
                    const [nodeId, ...pathSegments] = inline.attrs.id.split(".");
                    const ref: OutputSchemaSourceKey = {
                        nodeId,
                        path: pathSegments,
                    };
                    parts.push(this.resolveValue(ref, nodeOutputs));
                }
            }
        }
        return parts.join("");
    }

    /**
     * Execute an LLM node: build messages from TipTap content, stream the model,
     * and return parsed output.
     */
    private async executeLLMNode(
        data: LLMNodeData,
        nodeOutputs: Map<string, unknown>,
    ): Promise<{ output: unknown; tokens?: { prompt: number; completion: number } }> {
        const model = getModel(data.model.model);

        const messages: BaseMessage[] = data.messages
            .map((msg) => {
                const text = this.resolveTipTapContent(msg.content, nodeOutputs);
                if (!text.trim()) return null;
                switch (msg.role) {
                    case "system":
                        return new SystemMessage(text);
                    case "assistant":
                        return new AIMessage(text);
                    default:
                        return new HumanMessage(text);
                }
            })
            .filter((m): m is SystemMessage | AIMessage | HumanMessage => m !== null);

        if (messages.length === 0) {
            throw new Error(
                `LLM node "${data.name}" has no message content. Add text or variable references to at least one message.`,
            );
        }

        let fullResponse = "";
        let finalChunk: AIMessageChunk | null = null;
        const stream = await model.stream(messages);
        for await (const chunk of stream) {
            finalChunk = finalChunk ? finalChunk.concat(chunk) : chunk;
            const content = extractTextFromContent(chunk.content);
            if (content) fullResponse += content;
        }

        const usageMeta = finalChunk?.usage_metadata;
        const tokens = usageMeta
            ? { prompt: usageMeta.input_tokens ?? 0, completion: usageMeta.output_tokens ?? 0 }
            : undefined;

        // Try to parse as JSON if the output schema expects structured output
        if (data.outputSchema?.properties) {
            try {
                return { output: JSON.parse(fullResponse), tokens };
            } catch {
                const firstKey = Object.keys(data.outputSchema.properties)[0];
                if (firstKey) return { output: { [firstKey]: fullResponse }, tokens };
            }
        }
        return { output: { answer: fullResponse }, tokens };
    }

    /**
     * Execute an HTTP node: resolve URL / headers / query / body, make the
     * request, and return { status, data }.
     */
    private async executeHTTPNode(
        data: HttpNodeData,
        nodeOutputs: Map<string, unknown>,
    ): Promise<unknown> {
        const url = this.resolveValue(data.url, nodeOutputs);
        if (!url) throw new Error("HTTP node: URL is empty");

        // Build query params
        const queryParams = new URLSearchParams();
        for (const q of data.query) {
            if (q.key && q.value !== undefined) {
                queryParams.set(
                    q.key,
                    this.resolveValue(q.value, nodeOutputs),
                );
            }
        }
        const queryString = queryParams.toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;

        // Build headers
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        for (const h of data.headers) {
            if (h.key && h.value !== undefined) {
                headers[h.key] = this.resolveValue(h.value, nodeOutputs);
            }
        }

        // Build body
        let body: string | undefined;
        if (data.body && data.method !== "GET" && data.method !== "HEAD") {
            body = this.resolveValue(data.body, nodeOutputs);
        }

        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            data.timeout || 30000,
        );

        try {
            const response = await fetch(fullUrl, {
                method: data.method,
                headers,
                body,
                signal: controller.signal,
            });

            let responseData: unknown;
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                responseData = await response.text();
            }

            return { status: response.status, data: responseData };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Evaluate a single condition branch against node outputs.
     */
    private evaluateConditionBranch(
        branch: ConditionBranch,
        nodeOutputs: Map<string, unknown>,
    ): boolean {
        if (branch.type === "else") return true;
        if (branch.conditions.length === 0) return false;

        const results = branch.conditions.map((rule) => {
            const actualValue = this.resolveValue(rule.source, nodeOutputs);
            const expected = rule.value;

            switch (rule.operator) {
                case "eq":
                    return String(actualValue) === String(expected);
                case "neq":
                    return String(actualValue) !== String(expected);
                case "gt":
                    return Number(actualValue) > Number(expected);
                case "lt":
                    return Number(actualValue) < Number(expected);
                case "gte":
                    return Number(actualValue) >= Number(expected);
                case "lte":
                    return Number(actualValue) <= Number(expected);
                case "contains":
                    return String(actualValue).includes(String(expected));
                case "not_contains":
                    return !String(actualValue).includes(String(expected));
                case "starts_with":
                    return String(actualValue).startsWith(String(expected));
                case "ends_with":
                    return String(actualValue).endsWith(String(expected));
                case "is_empty":
                    return !actualValue || actualValue === "";
                case "is_not_empty":
                    return !!actualValue && actualValue !== "";
                case "is_true":
                    return (
                        actualValue === "true" ||
                        (actualValue as unknown) === true
                    );
                case "is_false":
                    return (
                        actualValue === "false" ||
                        (actualValue as unknown) === false
                    );
                default:
                    return false;
            }
        });

        return branch.logicalOperator === "AND"
            ? results.every(Boolean)
            : results.some(Boolean);
    }

    /**
     * Execute a condition node: evaluate IF / ELSE IF / ELSE branches and
     * return the matching branch id and type.
     */
    private executeConditionNode(
        data: ConditionNodeData,
        nodeOutputs: Map<string, unknown>,
    ): { branchId: string; branchType: string } {
        // Check IF branch
        if (this.evaluateConditionBranch(data.branches.if, nodeOutputs)) {
            return { branchId: data.branches.if.id, branchType: "if" };
        }
        // Check ELSE IF branches
        if (data.branches.elseIf) {
            for (const branch of data.branches.elseIf) {
                if (this.evaluateConditionBranch(branch, nodeOutputs)) {
                    return { branchId: branch.id, branchType: "elseIf" };
                }
            }
        }
        // Default to ELSE
        return { branchId: data.branches.else.id, branchType: "else" };
    }

    /**
     * Execute a template node: resolve TipTap template content to plain text.
     */
    private executeTemplateNode(
        data: TemplateNodeData,
        nodeOutputs: Map<string, unknown>,
    ): unknown {
        const text = this.resolveTipTapContent(
            data.template.tiptap,
            nodeOutputs,
        );
        return { text };
    }

    /**
     * Execute a RichWorkflow (node-based DAG).
     *
     * Performs a topological sort (Kahn's algorithm) and executes nodes
     * sequentially in dependency order, yielding stream events for each
     * node start / end. Saves a WorkflowExecution record with per-node
     * token usage.
     */
    async *executeRichWorkflow(params: {
        workflow: RichWorkflow;
        query: Record<string, unknown>;
    }): AsyncGenerator<RichWorkflowStreamEvent> {
        const { workflow, query } = params;
        const nodeOutputs = new Map<string, unknown>();
        const executionStartMs = Date.now();

        const store = isDatabaseConfigured() ? new WorkflowStore() : null;
        let executionId: string | undefined;

        // Build adjacency from edges
        const childrenOf = new Map<string, string[]>();
        const parentsOf = new Map<string, string[]>();
        for (const node of workflow.nodes) {
            childrenOf.set(node.id, []);
            parentsOf.set(node.id, []);
        }
        for (const edge of workflow.edges) {
            childrenOf.get(edge.source)?.push(edge.target);
            parentsOf.get(edge.target)?.push(edge.source);
        }

        // Find topological order (BFS / Kahn's)
        const inDegree = new Map<string, number>();
        for (const node of workflow.nodes) {
            inDegree.set(node.id, parentsOf.get(node.id)?.length || 0);
        }
        const queue: string[] = [];
        for (const [id, deg] of inDegree) {
            if (deg === 0) queue.push(id);
        }
        const topoOrder: string[] = [];
        while (queue.length > 0) {
            const current = queue.shift()!;
            topoOrder.push(current);
            for (const child of childrenOf.get(current) || []) {
                const newDeg = (inDegree.get(child) || 1) - 1;
                inDegree.set(child, newDeg);
                if (newDeg === 0) queue.push(child);
            }
        }

        const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));

        // Build execution steps (one per node)
        const executionSteps: WorkflowExecutionStep[] = workflow.nodes.map((node) => ({
            stepId: node.id,
            stepName: node.name || node.kind,
            agentId: node.kind,
            status: "pending" as const,
        }));
        const stepIdxById = new Map(executionSteps.map((s, i) => [s.stepId, i]));

        if (store) {
            try {
                const execution = await store.createExecution({
                    workflowId: workflow.id,
                    userId: workflow.userId,
                    userName: workflow.userName,
                    userEmail: workflow.userEmail,
                    title: workflow.name,
                    status: "running",
                    startTime: new Date().toISOString(),
                    steps: executionSteps,
                    currentStepIndex: 0,
                    initialInput: JSON.stringify(query),
                });
                executionId = execution.id;
            } catch (err) {
                logger.error({ err }, "Failed to create rich workflow execution record");
            }
        }

        yield { eventType: "WORKFLOW_START", executionId };

        let finalOutput: string | undefined;
        let workflowError: string | undefined;

        for (const nodeId of topoOrder) {
            const node = nodeById.get(nodeId);
            if (!node) continue;

            const execId = crypto.randomUUID();
            const stepIdx = stepIdxById.get(nodeId);
            if (stepIdx !== undefined) {
                executionSteps[stepIdx].status = "running";
                executionSteps[stepIdx].startTime = new Date().toISOString();
            }

            yield {
                eventType: "NODE_START",
                nodeId: node.id,
                nodeExecutionId: execId,
                node: { name: node.id },
            };

            try {
                let output: unknown;
                let nodeTokens: { prompt: number; completion: number } | undefined;

                switch (node.data.kind) {
                    case NodeKind.Input:
                        output = query;
                        break;

                    case NodeKind.Output: {
                        const outputNodeData = node.data as import("@/lib/workflow/types").OutputNodeData;
                        const outputData = outputNodeData.outputData || [];
                        const result: Record<string, unknown> = {};
                        for (const item of outputData) {
                            if (item.source) {
                                result[item.key] = this.resolveValue(item.source, nodeOutputs);
                            }
                        }
                        output =
                            Object.keys(result).length > 0
                                ? result
                                : nodeOutputs.get((parentsOf.get(node.id) || [])[0]);
                        finalOutput = typeof output === "string" ? output : JSON.stringify(output);
                        break;
                    }

                    case NodeKind.LLM: {
                        const llmResult = await this.executeLLMNode(
                            node.data as LLMNodeData,
                            nodeOutputs,
                        );
                        output = llmResult.output;
                        nodeTokens = llmResult.tokens;
                        break;
                    }

                    case NodeKind.Http:
                        output = await this.executeHTTPNode(
                            node.data as HttpNodeData,
                            nodeOutputs,
                        );
                        break;

                    case NodeKind.Condition: {
                        const condResult = this.executeConditionNode(
                            node.data as ConditionNodeData,
                            nodeOutputs,
                        );
                        output = condResult;
                        break;
                    }

                    case NodeKind.Template:
                        output = this.executeTemplateNode(
                            node.data as TemplateNodeData,
                            nodeOutputs,
                        );
                        break;

                    case NodeKind.Note:
                        output = {};
                        break;

                    default:
                        output = {};
                        break;
                }

                nodeOutputs.set(node.id, output);

                if (stepIdx !== undefined) {
                    executionSteps[stepIdx].status = "completed";
                    executionSteps[stepIdx].endTime = new Date().toISOString();
                    executionSteps[stepIdx].output =
                        typeof output === "string" ? output : JSON.stringify(output);
                    if (nodeTokens) executionSteps[stepIdx].tokens = nodeTokens;
                }

                if (executionId && store) {
                    try {
                        await store.updateExecution(executionId, workflow.id, {
                            steps: executionSteps,
                            currentStepIndex: topoOrder.indexOf(nodeId),
                        });
                    } catch (err) {
                        logger.warn({ err }, "Failed to update rich workflow execution step");
                    }
                }

                yield {
                    eventType: "NODE_END",
                    nodeId: node.id,
                    nodeExecutionId: execId,
                    node: { name: node.id },
                    isOk: true,
                    output,
                    tokens: nodeTokens,
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error({ err: error }, `[RichWorkflow] Node ${node.id} failed: ${errorMsg}`);
                workflowError = errorMsg;

                if (stepIdx !== undefined) {
                    executionSteps[stepIdx].status = "error";
                    executionSteps[stepIdx].endTime = new Date().toISOString();
                    executionSteps[stepIdx].error = errorMsg;
                }

                yield {
                    eventType: "NODE_END",
                    nodeId: node.id,
                    nodeExecutionId: execId,
                    node: { name: node.id },
                    isOk: false,
                    error: errorMsg,
                };
            }
        }

        const runDuration = Math.round((Date.now() - executionStartMs) / 1000);
        const aggTokens = executionSteps.reduce(
            (acc, s) => {
                if (s.tokens) { acc.prompt += s.tokens.prompt; acc.completion += s.tokens.completion; }
                return acc;
            },
            { prompt: 0, completion: 0 },
        );

        if (executionId && store) {
            try {
                await store.updateExecution(executionId, workflow.id, {
                    status: workflowError ? "error" : "completed",
                    endTime: new Date().toISOString(),
                    duration: runDuration,
                    steps: executionSteps,
                    finalOutput,
                    error: workflowError,
                    tokenUsage: aggTokens.prompt + aggTokens.completion > 0
                        ? { ...aggTokens, total: aggTokens.prompt + aggTokens.completion }
                        : undefined,
                });
            } catch (err) {
                logger.warn({ err }, "Failed to finalize rich workflow execution");
            }
        }

        yield { eventType: "WORKFLOW_END", isOk: !workflowError };
    }
}

// Singleton instance
export const workflowExecutionService = new WorkflowExecutionService();
