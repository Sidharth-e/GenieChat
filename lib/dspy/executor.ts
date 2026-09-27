import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "@/lib/logger";
import { extractTokenUsage } from "@/lib/langchain/langchain-utility";
import { ModuleResult } from "./types";
import { getModel, getDefaultModel } from "../langchain/model-factory";

/**
 * Executes a structured AI call using LangChain.
 */
export async function execute<T extends Record<string, unknown>>(
  model: BaseChatModel,
  systemPrompt: string,
  userMessage: string,
  outputSchema: z.ZodType<T>,
): Promise<ModuleResult<T>> {
  try {
    // Primary path: Use LangChain's native structured output
    // This uses tool-calling or JSON mode depending on the provider.
    const structuredModel = model.withStructuredOutput(outputSchema, { includeRaw: true });

    // LangChain does not export the includeRaw return type; cast is safe because
    // includeRaw: true always produces { raw: AIMessage, parsed: T }.
    const invocation = await structuredModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ]) as { raw: AIMessage; parsed: T };

    if (!invocation.parsed) {
      throw new Error("Model returned empty result via withStructuredOutput.");
    }

    const tokens = extractTokenUsage(invocation.raw);
    return { data: invocation.parsed, tokens };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`withStructuredOutput failed, falling back to manual extraction: ${errorMessage}`);

    // Fallback path: Manual JSON extraction
    // Fallback for models that do not support tool-calling consistently.
    const fallbackSystemPrompt = `${systemPrompt}\n\nIMPORTANT: You MUST respond ONLY with a valid JSON object matching the required schema. Do not include any conversational text or markdown formatting except for code blocks if necessary.`;

    const response = await model.invoke([
      new SystemMessage(fallbackSystemPrompt),
      new HumanMessage(userMessage),
    ]);

    const content = typeof response.content === "string" 
      ? response.content 
      : JSON.stringify(response.content);

    // Extract JSON from markdown code blocks if present
    const cleanContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from model response.");
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const validated = outputSchema.safeParse(parsed);

      if (!validated.success) {
        throw new Error(`Schema validation failed: ${validated.error.message}`);
      }

      const tokens = extractTokenUsage(response);
      return { data: validated.data, raw: content, tokens };
    } catch (parseError: unknown) {
      const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse or validate JSON: ${parseErrorMessage}`);
    }
  }
}

/**
 * Resolves a model instance from configuration.
 */
export function resolveModel(modelId?: string, model?: BaseChatModel, temperature?: number): BaseChatModel {
  if (model) return model;
  
  if (modelId) {
    return getModel(modelId, temperature !== undefined ? { temperature } : {});
  }
  
  return getDefaultModel(temperature !== undefined ? { temperature } : {});
}
