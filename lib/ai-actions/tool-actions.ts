"use server";

import { logger } from "@/lib/logger";
import { generateResponseWithUsage, UserContext } from "@/lib/langchain/langchain-utility";
import { getModel } from "@/lib/langchain/model-factory";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { CustomToolParameter } from "@/lib/types";
import { logActionUsage } from "./log-action-usage";

export interface GeneratedTool {
    name: string;
    description: string;
    category: string;
    code: string;
    parameters: CustomToolParameter[];
}

/**
 * Server Action to generate a tool configuration based on user request.
 * 
 * @param toolDescription - The user's description for the tool.
 * @returns A JSON object containing { name, description, category, code, parameters }
 */
export async function generateToolAction(toolDescription: string): Promise<GeneratedTool | null> {
    try {
        const sessionUser = await getSessionUser();
        const userContext: UserContext | undefined = sessionUser ? {
            name: sessionUser.name,
            email: sessionUser.email,
        } : undefined;

        const generationModel = getModel("gemini-3-flash-preview");
        
        const metaSystemPrompt = `You are an expert AI tool developer. Your goal is to create a Javascript tool configuration based on the user's description.
        
        The user wants a tool that can be used by an AI agent.
        The "code" field must be a valid Javascript async function named "handle" that takes "params" as an argument.
        The "parameters" field must be an ARRAY of parameter objects, not a JSON Schema object.
        
        Output format must be valid, parseable JSON with the following structure:
        {
            "name": "ToolName",
            "description": "Short description of what the tool does",
            "category": "Utility", // or "Data", "Integration", etc.
            "code": "async function handle(params) { ... }",
            "parameters": [
                {
                    "name": "city",
                    "type": "string", // "string", "number", "boolean", "object", "array"
                    "description": "City name",
                    "required": true
                }
            ]
        }
        
        Return ONLY the raw JSON. Do not include markdown code fence blocks.`;
        
        const userRequest = `User Request: ${toolDescription}`;
        
        const startTime = Date.now();
        const { content: responseText, tokens } = await generateResponseWithUsage(metaSystemPrompt, userRequest, generationModel, userContext);
        logger.info({ userId: sessionUser?.id, action: "generateToolAction", model: "gemini-3-flash-preview", tokens }, "[Action] LLM usage");
        logActionUsage(sessionUser?.id, "generateToolAction", tokens, Date.now() - startTime, responseText).catch(() => {});

        // Clean up response
        const cleanedResponse = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        
        try {
            const parsed = JSON.parse(cleanedResponse) as Partial<GeneratedTool>;
            return {
                name: parsed.name || "GeneratedTool",
                description: parsed.description || "",
                category: parsed.category || "Utility",
                code: parsed.code || "async function handle(params) {\n  return { success: true };\n}",
                parameters: Array.isArray(parsed.parameters)
                    ? (parsed.parameters as CustomToolParameter[])
                    : []
            };
        } catch {
            logger.error("Failed to parse AI tool response as JSON:", responseText);
            return null;
        }

    } catch (error) {
        logger.error("Error in generateToolAction:", error);
        throw new Error("Failed to generate tool. Please try again.");
    }
}
