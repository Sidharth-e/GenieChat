"use server";

import { logger } from "@/lib/logger";
import { generateResponseWithUsage, UserContext } from "@/lib/langchain/langchain-utility";
import { getModel } from "@/lib/langchain/model-factory";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { logActionUsage } from "./log-action-usage";

/**
 * Server Action to generate a prompt template and categories based on user request.
 *
 * @param promptQuery - The user's request for the prompt.
 * @returns A JSON string containing { title: string, template: string, tags: string[] }
 */
export async function generatePromptTemplateAction(promptQuery: string): Promise<{ title: string, template: string, tags: string[] }> {
    try {
        // Get user context from session for variable replacement logic if needed in future
        // For now, we mainly need the authenticated session to ensure valid usage
        const sessionUser = await getSessionUser();
        const userContext: UserContext | undefined = sessionUser ? {
            name: sessionUser.name,
            email: sessionUser.email,
        } : undefined;

        // Use a fast model for generation
        const generationModel = getModel("gemini-3-flash-preview");

        const metaSystemPrompt = `You are an expert AI prompt engineer. Your goal is to create a high-quality prompt template and suggest relevant categories/tags based on the user's request.

        The user wants a prompt they can use with an LLM.
        The prompts should use {{variable}} syntax for placeholders (e.g., {{document}}, {{date}}).

        Output format must be valid, parseable JSON with the following structure:
        {
            "title": "A short, concise, and descriptive title for the prompt",
            "template": "The actual text of the prompt template...",
            "tags": ["tag1", "tag2", "tag3"]
        }

        Return ONLY the raw JSON. Do not include markdown code fence blocks (like \`\`\`json). Just the raw JSON string.`;

        const userRequest = `User Request: ${promptQuery}`;

        const startTime = Date.now();
        const { content: responseText, tokens } = await generateResponseWithUsage(metaSystemPrompt, userRequest, generationModel, userContext);
        logger.info({ userId: sessionUser?.id, action: "generatePromptTemplateAction", model: "gemini-3-flash-preview", tokens }, "[Action] LLM usage");
        logActionUsage(sessionUser?.id, "generatePromptTemplateAction", tokens, Date.now() - startTime, responseText).catch(() => {});

        // Clean up response if it accidentally includes markdown code blocks
        const cleanedResponse = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        try {
            const parsed = JSON.parse(cleanedResponse);
            return {
                title: parsed.title || "",
                template: parsed.template || "",
                tags: Array.isArray(parsed.tags) ? parsed.tags : []
            };
        } catch {
            logger.error("Failed to parse AI response as JSON:", responseText);
            // Fallback if parsing fails
            return {
                title: "Generated Prompt",
                template: responseText,
                tags: ["generated"]
            };
        }

    } catch (error) {
        logger.error("Error in generatePromptTemplateAction:", error);
        throw new Error("Failed to generate prompt template. Please try again.");
    }
}
