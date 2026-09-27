"use server";

import { logger } from "@/lib/logger";
import { generateResponseWithUsage, UserContext } from "@/lib/langchain/langchain-utility";
import { getModel } from "@/lib/langchain/model-factory";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { logActionUsage } from "./log-action-usage";

export interface GeneratedAgent {
    name: string;
    description: string;
    systemPrompt: string;
    modelId?: string;
    tools?: string[];
    subAgents?: { id: string; name: string }[];
    skills?: { name: string; description: string; instructions: string }[];
}

export interface AgentToolOption {
    id: string;
    name: string;
    description: string;
    source: "default" | "mcp";
}

export interface AgentModelOption {
    id: string;
    name: string;
    provider: string;
    description: string;
}

export interface AgentSubAgentOption {
    id: string;
    name: string;
}

interface GenerateAgentOptions {
    includeTools?: boolean;
    toolOptions?: AgentToolOption[];
    includeModel?: boolean;
    modelOptions?: AgentModelOption[];
    includeSubAgents?: boolean;
    subAgentOptions?: AgentSubAgentOption[];
    includeSkills?: boolean;
}

/**
 * Server Action to generate an agent configuration based on user request.
 *
 * @param agentDescription - The user's description for the agent.
 * @returns A JSON object containing { name, description, systemPrompt, modelId, tools }
 */
export async function generateAgentAction(
    agentDescription: string,
    options?: GenerateAgentOptions,
): Promise<GeneratedAgent | null> {
    try {
        const sessionUser = await getSessionUser();
        const userContext: UserContext | undefined = sessionUser ? {
            name: sessionUser.name,
            email: sessionUser.email,
        } : undefined;

        const generationModel = getModel("gemini-3-flash-preview");
        const includeTools = options?.includeTools ?? false;
        const toolOptions = options?.toolOptions ?? [];
        const includeModel = options?.includeModel ?? false;
        const modelOptions = options?.modelOptions ?? [];
        const includeSubAgents = options?.includeSubAgents ?? false;
        const subAgentOptions = options?.subAgentOptions ?? [];
        const includeSkills = options?.includeSkills ?? false;
        const validToolIds = new Set(toolOptions.map((tool) => tool.id));
        const validModelIds = new Set(modelOptions.map((model) => model.id));
        const validSubAgents = new Map(
            subAgentOptions.map((agent) => [agent.id, agent.name]),
        );

        const toolsOutputGuidance = includeTools
            ? `,
            "tools": ["default:web_search", "my-mcp-server:search_docs"]`
            : "";
        const modelOutputGuidance = includeModel
            ? `"modelId": "gemini-3-flash-preview"`
            : `"modelId": ""`;
        const subAgentsOutputGuidance = includeSubAgents
            ? `,
            "subAgents": [{"id": "agent_123", "name": "Research Specialist"}]`
            : "";
        const skillsOutputGuidance = includeSkills
            ? `,
            "skills": [{"name": "Code Review", "description": "Reviews code for bugs and best practices", "instructions": "When reviewing code, focus on..."}]`
            : "";

        const toolsSelectionRules = includeTools && toolOptions.length > 0
            ? `
        You must choose tools ONLY from the provided "Available Tool Catalog".
        Return the selected tool IDs in the "tools" array.
        Prefer the smallest useful tool set (usually 2-6 tools; max 8).
        If no tools are necessary, return an empty tools array.`
            : "";
        const modelSelectionRules = includeModel && modelOptions.length > 0
            ? `
        You must choose modelId ONLY from the provided "Available Model Catalog".
        Pick one model that best matches the user's requested quality/speed tradeoff.`
            : "";
        const subAgentSelectionRules =
            includeSubAgents && subAgentOptions.length > 0
                ? `
        You must choose sub-agents ONLY from the provided "Available Sub-Agent Catalog".
        Return subAgents as an array of objects with id and name.
        Use a small team (usually 1-4) and only include agents that materially help.`
                : "";
        const skillsGenerationRules = includeSkills
            ? `
        You may generate 1-4 skills. Each skill must have a name, description, and detailed instructions.
        Skills are reusable behavioral modules — they define specific capabilities or behaviors.
        Instructions should be detailed enough to meaningfully change the agent's behavior.`
            : "";

        const toolCatalogText = includeTools && toolOptions.length > 0
            ? `\n\nAvailable Tool Catalog (id | source | name | description):\n${toolOptions
                .map((tool) => `${tool.id} | ${tool.source} | ${tool.name} | ${tool.description}`)
                .join("\n")}`
            : "";
        const modelCatalogText = includeModel && modelOptions.length > 0
            ? `\n\nAvailable Model Catalog (id | name | provider | description):\n${modelOptions
                .map((model) => `${model.id} | ${model.name} | ${model.provider} | ${model.description}`)
                .join("\n")}`
            : "";
        const subAgentCatalogText =
            includeSubAgents && subAgentOptions.length > 0
                ? `\n\nAvailable Sub-Agent Catalog (id | name):\n${subAgentOptions
                      .map((agent) => `${agent.id} | ${agent.name}`)
                      .join("\n")}`
                : "";

        const metaSystemPrompt = `You are an expert AI agent designer. Your goal is to create a useful agent profile from the user's request.

        Output format must be valid, parseable JSON with the following structure:
        {
            "name": "Short, descriptive agent name",
            "description": "One-line purpose of the agent",
            "systemPrompt": "Detailed system instructions that define behavior, scope, constraints, and response style",
            ${modelOutputGuidance}${toolsOutputGuidance}${subAgentsOutputGuidance}${skillsOutputGuidance}
        }

        ${toolsSelectionRules}
        ${modelSelectionRules}
        ${subAgentSelectionRules}
        ${skillsGenerationRules}

        The systemPrompt should be production-ready and explicit about behavior.
        Return ONLY the raw JSON. Do not include markdown code fence blocks.`;

        const userRequest = `User Request: ${agentDescription}${toolCatalogText}${modelCatalogText}${subAgentCatalogText}`;

        const startTime = Date.now();
        const { content: responseText, tokens } = await generateResponseWithUsage(metaSystemPrompt, userRequest, generationModel, userContext);
        logger.info({ userId: sessionUser?.id, action: "generateAgentAction", model: "gemini-3-flash-preview", tokens }, "[Action] LLM usage");
        logActionUsage(sessionUser?.id, "generateAgentAction", tokens, Date.now() - startTime, responseText).catch(() => {});
        const cleanedResponse = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        try {
            const parsed = JSON.parse(cleanedResponse) as Partial<GeneratedAgent>;
            const parsedTools = Array.isArray(parsed.tools)
                ? parsed.tools.filter((toolId): toolId is string => typeof toolId === "string")
                : [];
            const sanitizedTools = includeTools
                ? parsedTools.filter((toolId) => validToolIds.has(toolId)).slice(0, 8)
                : [];
            const sanitizedModelId = includeModel && typeof parsed.modelId === "string" && validModelIds.has(parsed.modelId)
                ? parsed.modelId
                : undefined;
            const parsedSubAgentsRaw = Array.isArray(parsed.subAgents)
                ? parsed.subAgents
                : [];
            const parsedSubAgentIds = parsedSubAgentsRaw
                .map((agent) => {
                    if (typeof agent === "string") {
                        return agent;
                    }
                    if (
                        agent &&
                        typeof agent === "object" &&
                        "id" in agent &&
                        typeof (agent as { id: unknown }).id === "string"
                    ) {
                        return (agent as { id: string }).id;
                    }
                    return null;
                })
                .filter((id): id is string => Boolean(id));
            const uniqueSubAgentIds = Array.from(new Set(parsedSubAgentIds));
            const sanitizedSubAgents = includeSubAgents
                ? uniqueSubAgentIds
                    .filter((id) => validSubAgents.has(id))
                    .slice(0, 6)
                    .map((id) => ({ id, name: validSubAgents.get(id) || id }))
                : [];

            const parsedSkills = includeSkills && Array.isArray(parsed.skills)
                ? (parsed.skills as Record<string, unknown>[])
                    .filter(
                        (s): s is { name: string; description: string; instructions: string } =>
                            !!s &&
                            typeof s === "object" &&
                            typeof s.name === "string" &&
                            typeof s.instructions === "string",
                    )
                    .slice(0, 4)
                : [];

            return {
                name: parsed.name || "Generated Agent",
                description: parsed.description || "",
                systemPrompt: parsed.systemPrompt || "",
                modelId: sanitizedModelId,
                tools: sanitizedTools,
                subAgents: sanitizedSubAgents,
                skills: parsedSkills,
            };
        } catch {
            logger.error("Failed to parse AI agent response as JSON:", responseText);
            return null;
        }
    } catch (error) {
        logger.error("Error in generateAgentAction:", error);
        throw new Error("Failed to generate agent. Please try again.");
    }
}

/**
 * Server Action to generate or refine a system prompt using an AI model.
 * 
 * @param promptQuery - The user's request for the system prompt.
 * @param currentSystemPrompt - The existing system prompt, if any.
 * @returns The generated/refined system prompt.
 */
export async function generateSystemPromptAction(promptQuery: string, currentSystemPrompt: string): Promise<string> {
    try {
        // Get user context from session for variable replacement
        const sessionUser = await getSessionUser();
        const userContext: UserContext | undefined = sessionUser ? {
            name: sessionUser.name,
            email: sessionUser.email,
        } : undefined;

        // Use a fast model for generation
        const generationModel = getModel("gemini-3-flash-preview");
        
        const metaSystemPrompt = `You are an expert AI prompt engineer. Your goal is to create or refine a system instruction (system prompt) for an AI agent based on the user's request.
        
        If the user provides existing instructions, refine them to be more effective, clear, and robust.
        If the user provides a goal or description, create a comprehensive system prompt from scratch.
        
        Return ONLY the refined system prompt text. Do not include any explanations or conversational chatter.`;
        
        const userRequest = `User Request: ${promptQuery}\n\nCurrent System Prompt (if any): ${currentSystemPrompt}`;
        
        const startTime = Date.now();
        const { content: response, tokens } = await generateResponseWithUsage(metaSystemPrompt, userRequest, generationModel, userContext);
        logger.info({ userId: sessionUser?.id, action: "generateSystemPromptAction", model: "gemini-3-flash-preview", tokens }, "[Action] LLM usage");
        logActionUsage(sessionUser?.id, "generateSystemPromptAction", tokens, Date.now() - startTime, response).catch(() => {});

        return response;
    } catch (error) {
        logger.error("Error in generateSystemPromptAction:", error);
        throw new Error("Failed to generate prompt. Please try again.");
    }
}
