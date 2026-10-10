import { tool, StructuredTool } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import * as z from "zod";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { STORAGE_BUCKETS } from "@/constants/storage";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_ASPECT_RATIOS,
} from "@/constants/generation";
import { storageDownloadUrl } from "@/lib/artifacts/display-url";
import { keyForUser } from "@/lib/storage/ref";
import { generateId } from "@/lib/utils";

const EXA_TIMEOUT_MS = 60_000;

export const webSearch = tool(
  async (input) => {
    const apiKey = config.exa.apiKey;

    if (!apiKey) {
      return JSON.stringify({
        error:
          "Exa API key not configured. Please set EXA_API_KEY environment variable.",
      });
    }

    try {
      const response = await fetch(`${config.exa.baseUrl}/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ query: input.query }),
        signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return JSON.stringify({
          error: `Failed to search: Exa returned ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
        });
      }

      const data = (await response.json()) as {
        answer?: string;
        citations?: { title?: string; url?: string }[];
      };
      const citations = (data.citations ?? [])
        .map((citation) => citation.url)
        .filter((url): url is string => Boolean(url));

      return JSON.stringify({
        answer: data.answer || "No answer found",
        citations,
        query: input.query,
        note:
          citations.length > 0
            ? `Found ${citations.length} source(s). Citations are numbered [1], [2], etc. in the answer.`
            : "No citations available for this query.",
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to search: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  {
    name: "web_search",
    description:
      "Search the real-time internet. Use this for: 1) News and current events. 2) Facts you are unsure about. 3) Specific information (scores, stock prices, checking facts). Do NOT use for general knowledge you already have.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "The search query. Be specific! (e.g. 'current apple stock price' instead of 'apple')",
        ),
    }),
  },
);



/**
 * Built per request, not once per module: the tool searches one owner's
 * knowledge, and the owner comes from the authenticated user, which the model
 * must not be able to choose. A module-level singleton could not know it.
 */
export function createKnowledgeBaseSearchTool(userId: string) {
  return tool(
    async (input) => {
      if (!input.agentId) {
        return JSON.stringify({
          error: "agentId is required to search an agent's knowledge base.",
        });
      }

      const { searchKnowledge } = await import("@/lib/knowledge/search");

      try {
        const hits = await searchKnowledge({
          ownerType: "agent",
          ownerId: input.agentId,
          userId,
          query: input.query,
          top: 5,
        });

        if (hits.length === 0) {
          return JSON.stringify({
            results: [],
            message: "No relevant documents found in the knowledge base.",
          });
        }

        return JSON.stringify({
          results: hits.map((hit) => ({
            content: hit.content,
            title: hit.title ?? null,
            sourceId: hit.sourceId ?? null,
            chunkIndex: hit.chunkIndex,
            score: hit.score,
          })),
        });
      } catch (error) {
        logger.error(
          { err: error, userId, agentId: input.agentId },
          "Knowledge base search failed",
        );
        return JSON.stringify({
          error: "Knowledge base search failed. Please try again.",
        });
      }
    },
    {
      name: "knowledge_base_search",
      description:
        "Search this agent's uploaded knowledge base documents for information relevant to a query. Use this when the user asks about content that may be in the agent's documents.",
      schema: z.object({
        query: z
          .string()
          .describe("The search query to find relevant documents"),
        agentId: z
          .string()
          .optional()
          .describe("The ID of the agent whose knowledge base to search"),
      }),
    },
  );
}

export const createUseSkillTool = (
  skills: { name: string; description: string; instructions: string }[],
) => {
  const skillNames = skills.map((s) => s.name);
  return tool(
    async (input) => {
      const match = skills.find(
        (s) => s.name.toLowerCase() === input.skill_name.toLowerCase(),
      );
      if (!match) {
        return JSON.stringify({
          error: `Skill "${input.skill_name}" not found. Available skills: ${skillNames.join(", ")}`,
        });
      }
      return JSON.stringify({
        skill: match.name,
        instructions: match.instructions,
      });
    },
    {
      name: "use_skill",
      description:
        "Activate a skill to receive its full instructions. Call this when a user's request matches one of your available skills. Pass the exact skill name.",
      schema: z.object({
        skill_name: z
          .string()
          .describe(
            `The name of the skill to activate. Available: ${skillNames.join(", ")}`,
          ),
      }),
    },
  );
};

/**
 * The container is keyed by this, so the thread is what decides it: every turn
 * of one conversation has to land in the container the turn before it wrote to,
 * or a file one turn produced is gone by the next. The model's `session_id`
 * cannot carry that — it is optional, and the model has no thread id to hand —
 * so it is consulted only where there is no thread to scope to. A blank thread
 * is no thread: an empty key names no container, and returning it here would
 * discard the fallback that is the only session those surfaces have.
 */
export const sandboxSessionId = (
  chatId: string | undefined,
  requestedSessionId: string | undefined,
): string | undefined => chatId || requestedSessionId;

export const createCodeSandboxTool = (userId?: string, chatId?: string) =>
  tool(
    async (input) => {
      const { executeInContainer } = await import("./code-sandbox");
      const sessionId = sandboxSessionId(chatId, input.session_id);
      const result = await executeInContainer({
        code: input.code,
        language: input.language,
        sessionId,
        userId,
        chatId: sessionId,
      });

      return JSON.stringify({
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        container_id: result.containerId,
        files: result.files,
        error: result.error,
      });
    },
    {
      name: "code_sandbox",
      description:
        "Execute Python code or bash commands inside a stateful, sandboxed Linux container. Use this to perform data analysis, run scripts, execute math/computations, and inspect files.",
      schema: z.object({
        code: z
          .string()
          .describe("The Python code or bash commands to execute in the sandbox"),
        language: z
          .enum(["python", "bash"])
          .default("python")
          .describe("Language: 'python' (default) or 'bash'"),
        session_id: z
          .string()
          .optional()
          .describe(
            "Optional session or thread identifier to preserve files and state across turns",
          ),
      }),
    },
  );

export const codeSandbox = createCodeSandboxTool();

/**
 * Generates an image and stores it, returning the markdown that renders it.
 *
 * The tool uploads its own bytes rather than handing them to the artifact
 * envelope: an image is megabytes of base64, and the envelope is both streamed
 * to the client and persisted in the message, so routing the bytes through it
 * would bloat the wire and the thread document alike. What travels instead is
 * the ref, and the reply carries a markdown image pointing at the proxy URL —
 * which presigns afresh on every read, so the picture survives the TTL on any
 * one signature.
 */
export const createGenerateImageTool = (userId?: string, chatId?: string) =>
  tool(
    async (input) => {
      if (!userId) {
        return JSON.stringify({
          error: "Image generation needs an authenticated user.",
        });
      }

      const model = input.model?.trim() || DEFAULT_IMAGE_MODEL;

      try {
        const [
          { generateImage, extensionForMediaType, mediaTypeForExtension, markdownImageFor },
          { putObject },
        ] = await Promise.all([
          import("@/lib/generation"),
          import("@/lib/storage"),
        ]);

        const result = await generateImage({
          model,
          prompt: input.prompt,
          aspectRatio: input.aspect_ratio,
        });

        // The API can return several; one image per call is what the tool
        // advertises, so the first is the answer and the rest are ignored.
        const image = result.images[0];
        const ext = extensionForMediaType(image.mediaType);
        const uploaded = await putObject(
          STORAGE_BUCKETS.generatedImages,
          keyForUser(userId, "image", `${generateId()}.${ext}`),
          Buffer.from(image.base64, "base64"),
          image.mediaType || mediaTypeForExtension(ext),
        );

        if (uploaded.status !== "OK") {
          logger.error({ err: uploaded }, "Failed to store a generated image");
          return JSON.stringify({
            error: "The image was generated but could not be stored.",
          });
        }

        const url = storageDownloadUrl(uploaded.response);

        return JSON.stringify({
          success: true,
          url,
          model,
          format: ext,
          aspect_ratio: input.aspect_ratio ?? "auto",
          markdown: markdownImageFor(input.prompt, url),
          note: "Include the markdown field verbatim in your reply so the image renders for the user.",
          _artifact: {
            type: "image",
            title: input.prompt.slice(0, 120),
            url: uploaded.response,
            metadata: {
              model,
              format: ext,
              aspectRatio: input.aspect_ratio ?? null,
              costUsd: result.costUsd ?? null,
            },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, model }, "Image generation failed");
        return JSON.stringify({
          error: `Failed to generate the image: ${message}`,
        });
      }
    },
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt and post it into the conversation. Use this whenever the user asks for a picture, illustration, artwork, logo concept or photo. The result carries a `markdown` field holding the image; include that markdown verbatim in your reply so the image is shown.",
      schema: z.object({
        prompt: z
          .string()
          .min(1)
          .describe(
            "What to draw, described fully — subject, style, composition and lighting — rather than a filename.",
          ),
        aspect_ratio: z
          .enum(IMAGE_ASPECT_RATIOS)
          .optional()
          .describe(
            "Optional aspect ratio. Omit unless the request implies a shape, so the model's default stands.",
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Optional image-model slug overriding the default. Set this only when the user names a specific model.",
          ),
      }),
    },
  );

export const defaultTools = [webSearch, codeSandbox];

const defaultToolsMap: Record<string, StructuredTool> = {
  web_search: webSearch,
  code_sandbox: codeSandbox,
};

/**
 * The single place a `default:`-prefixed tool name becomes a tool. Three of them
 * need the caller's identity, so the name alone is not enough.
 */
export function resolveDefaultTool(
  name: string,
  userId?: string,
  chatId?: string,
): StructuredToolInterface | undefined {
  if (name === "knowledge_base_search") {
    return userId ? createKnowledgeBaseSearchTool(userId) : undefined;
  }
  if (name === "code_sandbox") {
    return userId ? createCodeSandboxTool(userId, chatId) : codeSandbox;
  }
  // No user-less fallback, unlike the sandbox: a generated image has to be
  // stored under an owner, so a tool that cannot name one could only fail.
  if (name === "generate_image") {
    return userId ? createGenerateImageTool(userId, chatId) : undefined;
  }
  return defaultToolsMap[name];
}

// Declared in `default-tools-metadata.ts` so the client picker can import it
// without pulling this module's `@/lib/config`/`server-only` graph into the
// bundle; re-exported here, beside the resolver it describes.
export { RESOLVABLE_DEFAULT_TOOLS } from "./default-tools-metadata";

export default defaultToolsMap;
