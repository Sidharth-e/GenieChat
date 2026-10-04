import "server-only";
import { logger } from "@/lib/logger";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { format } from "date-fns";
import { v4 as uuidv4 } from "uuid";

// Normalize token usage across LangChain providers.
// - usage_metadata: the standardized field, populated by both Google and Ollama
// - response_metadata.tokenUsage / .usage: older provider-specific shapes
function extractTokenUsage(
  response: AIMessage,
): { prompt: number; completion: number } | undefined {
  if (response.usage_metadata) {
    return {
      prompt: response.usage_metadata.input_tokens,
      completion: response.usage_metadata.output_tokens,
    };
  }
  const meta = response.response_metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;

  const tu = (meta.tokenUsage ?? meta.usage) as Record<string, number> | undefined;
  if (!tu) return undefined;

  const prompt = tu.promptTokens ?? tu.prompt_tokens ?? 0;
  const completion = tu.completionTokens ?? tu.completion_tokens ?? 0;
  if (prompt === 0 && completion === 0) return undefined;
  return { prompt, completion };
}

export { extractTokenUsage };

/**
 * User context for variable replacement.
 * Pass this from session on server or from Zustand store on client.
 */
export interface UserContext {
  name?: string;
  email?: string;
  timezone?: string;
  memories?: string[];
  /**
   * The authenticated user's id. Carried so per-request tools can be built with
   * their owner baked in — a tool factory cannot read it from anywhere else.
   */
  userId?: string;
  threadId?: string;
}

/**
 * Replaces variable placeholders in a prompt with their actual values.
 * Supported variables: {date}, {time}, {datetime}, {weekday}, {month}, {year}, {iso_timestamp}, {uuid}, {user_name}, {user_email}, {timezone}, {local_datetime}, {user_memories}
 *
 * Every arm that interpolates a user-supplied string passes a **function** to
 * `replace`, never a string. `String.prototype.replace` reads `$&`, `$'` and `$n`
 * in a string replacement as substitution patterns, so a memory the user phrased
 * with a `$`, a GitHub display name containing `$&`, or a `$'` in the timezone
 * header would rewrite the prompt around itself instead of appearing in it. A
 * function's return value is inserted literally.
 *
 * @param content - The prompt content containing placeholders.
 * @param userContext - Optional user context for {user_name}, {user_email}, and {timezone} variables.
 * @returns The prompt with variables replaced.
 */
export const replacePromptVariables = (
  content: string,
  userContext?: UserContext,
): string => {
  const now = new Date();
  const timezone =
    userContext?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Format with timezone info for local_datetime
  const localDatetimeWithTz = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  return content
    .replace(/{date}/g, format(now, "yyyy-MM-dd"))
    .replace(/{time}/g, format(now, "hh:mm aa"))
    .replace(/{datetime}/g, format(now, "yyyy-MM-dd HH:mm"))
    .replace(/{weekday}/g, format(now, "EEEE"))
    .replace(/{month}/g, format(now, "MMMM"))
    .replace(/{year}/g, format(now, "yyyy"))
    .replace(/{iso_timestamp}/g, now.toISOString())
    .replace(/{uuid}/g, () => uuidv4())
    .replace(/{user_name}/g, () => userContext?.name || "User")
    .replace(/{user_email}/g, () => userContext?.email || "user@example.com")
    .replace(/{timezone}/g, () => timezone)
    .replace(/{local_datetime}/g, () => localDatetimeWithTz)
    .replace(/{user_memories}/g, () =>
      userContext?.memories?.length
        ? userContext.memories.join("\n")
        : "None recorded yet.",
    );
};

/**
 * Generates a response from a LangChain chat model based on system and user prompts.
 * Automatically replaces variables in the system prompt.
 *
 * @param systemPrompt - The system instruction for the model.
 * @param userPrompt - The user's input message.
 * @param model - The LangChain BaseChatModel instance to use.
 * @param userContext - Optional user context for variable replacement.
 * @returns The content of the model's response as a string.
 */
export const generateResponse = async (
  systemPrompt: string,
  userPrompt: string,
  model: BaseChatModel,
  userContext?: UserContext,
): Promise<string> => {
  const { content } = await generateResponseWithUsage(
    systemPrompt,
    userPrompt,
    model,
    userContext,
  );
  return content;
};

export const generateResponseWithUsage = async (
  systemPrompt: string,
  userPrompt: string,
  model: BaseChatModel,
  userContext?: UserContext,
): Promise<{ content: string; tokens?: { prompt: number; completion: number } }> => {
  try {
    const processedSystemPrompt = replacePromptVariables(
      systemPrompt,
      userContext,
    );

    const messages = [
      new SystemMessage(processedSystemPrompt),
      new HumanMessage(userPrompt),
    ];

    const response = await model.invoke(messages);

    let content: string;
    if (typeof response.content === "string") {
      content = response.content;
    } else if (Array.isArray(response.content)) {
      content = response.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
    } else {
      content = String(response.content);
    }

    const tokens = extractTokenUsage(response);
    return { content, tokens };
  } catch (error) {
    logger.error("Error generating response:", error);
    throw error;
  }
};
