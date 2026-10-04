import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { store } from "@/lib/store";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { handleError, api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { MEMORY_FACT_TOP } from "@/constants/memory";
import { storageRefSchema } from "@/lib/storage/ref";
import { z } from "zod";
import {
  hydrateMessages,
  processDocuments,
  processImages,
  getHistoricalImages,
} from "@/lib/api/stream-helper";
import type { ArenaResponse, ArenaMetadata } from "@/lib/types";
import { createSseWriter, SSE_HEADERS } from "@/lib/api/stream/envelope";
import { buildAssistantPayload } from "@/lib/api/stream/events";
import { persistAssistantMessage } from "@/lib/api/stream/runner";
import { StreamPipeline } from "@/lib/api/stream-pipeline";

export const runtime = "nodejs";

const arenaRequestSchema = z.object({
  threadId: z.string().min(1).max(128).optional(),
  message: z.string().min(1),
  models: z.array(z.string().min(1).max(120)).min(2).max(3),
  memoryEnabled: z.boolean().optional(),
  documents: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        fileName: z.string().min(1).max(260),
        ref: storageRefSchema,
        mimeType: z.string().min(1).max(255).optional(),
      }),
    )
    .max(10)
    .optional(),
  images: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        fileName: z.string().min(1).max(260),
        ref: storageRefSchema,
        mimeType: z.string().min(1).max(255),
      }),
    )
    .max(8)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const rateLimit = await checkRateLimit(req, {
      namespace: "arena_stream",
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        "Rate limit exceeded.",
        rateLimit.retryAfterSeconds,
      );
    }

    const parsed = arenaRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return api.badRequest(
        parsed.error.issues[0]?.message || "Invalid request",
      );
    }

    const { message, models, memoryEnabled } = parsed.data;
    const userId = user.id;

    // Validate all models exist
    for (const modelId of models) {
      if (!AVAILABLE_MODELS.find((m) => m.id === modelId)) {
        return api.badRequest(`Unknown model: ${modelId}`);
      }
    }

    // Thread management
    let currentThreadId = parsed.data.threadId;
    let isNewThread = false;

    if (!currentThreadId) {
      const newThread = await store.createThread(
        userId,
        models[0],
        undefined,
        false,
        undefined,
        undefined,
        user.name,
        user.email,
      );
      currentThreadId = newThread.id;
      isNewThread = true;
    } else {
      const existingThread = await store.getThread(currentThreadId);
      if (!existingThread) {
        const newThread = await store.createThread(
          userId,
          models[0],
          undefined,
          false,
          undefined,
          currentThreadId,
          user.name,
          user.email,
        );
        currentThreadId = newThread.id;
        isNewThread = true;
      } else if (existingThread.userId !== userId) {
        return api.forbidden();
      }
    }

    // Get context messages
    const existingMessages = await store.getMessages(currentThreadId);
    const isFirstMessage = existingMessages.length === 0;

    // Process assets
    const docs = parsed.data.documents ?? [];
    const imgs = parsed.data.images ?? [];
    const processedDocuments = await processDocuments(docs, userId, "[Arena]");
    const { processedImages, imagesForAI: newImagesForAI } =
      await processImages(imgs, userId, "[Arena]");
    const historicalImages = await getHistoricalImages(
      existingMessages,
      userId,
      "[Arena]",
    );
    const imagesForAI = [...newImagesForAI, ...historicalImages];

    // Save user message
    const savedUserMessage = await store.addMessage(currentThreadId, {
      threadId: currentThreadId,
      userId,
      userName: user.name,
      userEmail: user.email,
      role: "user",
      content: message,
      model: models[0],
      documents: processedDocuments.length > 0 ? processedDocuments : undefined,
      images: processedImages.length > 0 ? processedImages : undefined,
    });

    // Hydrate messages for AI
    const rawMessages = [...existingMessages, savedUserMessage];
    const hydratedMessages = await hydrateMessages(
      rawMessages,
      userId,
      "[Arena]",
    );

    // Load memories
    let memoryStrings: string[] = [];
    if (memoryEnabled !== false) {
      try {
        const { MemoryGraphStore } =
          await import("@/lib/memory/graph-store");
        const memoryStore = new MemoryGraphStore();
        const recall = await memoryStore.recallFacts(
          userId,
          message,
          MEMORY_FACT_TOP,
        );
        memoryStrings = recall.facts.map((fact) => `- ${fact.text}`);
      } catch (err) {
        logger.warn({ err }, "Failed to load memories for arena");
      }
    }

    const timezone = req.headers.get("x-timezone") || "Asia/Kolkata";
    const userContext = {
      userId: user.id,
      name: user.name,
      email: user.email,
      timezone,
      memories: memoryStrings,
    };

    // Stream responses from all models
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const writeEvent = createSseWriter(controller, encoder);

        try {
          if (isNewThread) {
            writeEvent({ type: "thread", threadId: currentThreadId });
          }
          writeEvent({
            type: "user_message_saved",
            messageId: savedUserMessage.id,
          });

          // Run all models in parallel using streaming per-model
          // We collect results via Promise.allSettled for parallel execution
          // but also stream tokens as they arrive

          const modelPromises = models.map(async (modelId) => {
            const modelConfig = AVAILABLE_MODELS.find((m) => m.id === modelId);
            const startTime = Date.now();
            let fullContent = "";
            let promptTokens = 0;
            let completionTokens = 0;

            try {
              const { chatService } =
                await import("@/lib/langchain/chat-service");

              writeEvent({
                type: "arena_model_start",
                modelId,
                modelName: modelConfig?.name || modelId,
              });

              for await (const event of await chatService.streamChat({
                messages: hydratedMessages,
                modelId,
                images: imagesForAI,
                customTools: [],
                userContext,
              })) {
                if (event.type === "token") {
                  fullContent += event.content;
                  writeEvent({
                    type: "arena_token",
                    modelId,
                    content: event.content,
                  });
                } else if (event.type === "token_usage") {
                  promptTokens += event.promptTokens;
                  completionTokens += event.completionTokens;
                }
              }

              const latencyMs = Date.now() - startTime;
              writeEvent({
                type: "arena_model_done",
                modelId,
                latencyMs,
                tokens: { prompt: promptTokens, completion: completionTokens },
              });

              return {
                modelId,
                modelName: modelConfig?.name || modelId,
                provider: modelConfig?.provider || "unknown",
                content: fullContent,
                latencyMs,
                tokens: { prompt: promptTokens, completion: completionTokens },
                finishedAt: new Date().toISOString(),
              } satisfies ArenaResponse;
            } catch (err) {
              const errorMsg =
                err instanceof Error ? err.message : "Unknown error";
              logger.error({ err, modelId }, "Arena model stream error");
              writeEvent({
                type: "arena_model_error",
                modelId,
                error: errorMsg,
              });

              return {
                modelId,
                modelName: modelConfig?.name || modelId,
                provider: modelConfig?.provider || "unknown",
                content: "",
                latencyMs: Date.now() - startTime,
                tokens: { prompt: 0, completion: 0 },
                error: errorMsg,
                finishedAt: new Date().toISOString(),
              } satisfies ArenaResponse;
            }
          });

          const arenaResponses = await Promise.all(modelPromises);

          // Build arena metadata
          const arenaMetadata: ArenaMetadata = {
            isArena: true,
            responses: arenaResponses,
            winnerId: null,
          };

          // Save assistant message with the first successful response as the default content
          const firstSuccess =
            arenaResponses.find((r) => !r.error) || arenaResponses[0];
          const savedAssistantMessage = await persistAssistantMessage({
            context: {
              user,
              requestBody: { message, model: models[0] },
              threadId: currentThreadId!,
              isNewThread,
              isFirstMessage,
              isRegeneration: false,
            },
            payload: buildAssistantPayload({
              content: firstSuccess.content,
              model: firstSuccess.modelId,
              usage: {
                prompt: firstSuccess.tokens.prompt,
                completion: firstSuccess.tokens.completion,
                total: firstSuccess.tokens.prompt,
              },
              fallback: { prompt: 0, completion: 0, total: 0 },
              toolCalls: [],
              citations: [],
              arenaMetadata,
              zeroUsagePolicy: "omit",
            }),
          });

          writeEvent({
            type: "arena_complete",
            messageId: savedAssistantMessage?.id,
            responses: arenaResponses.map((r) => ({
              modelId: r.modelId,
              modelName: r.modelName,
              provider: r.provider,
              latencyMs: r.latencyMs,
              tokens: r.tokens,
              error: r.error,
            })),
          });

          await StreamPipeline.generateTitleIfNeeded(
            currentThreadId!,
            isFirstMessage,
            encoder,
            controller,
          );

          writeEvent({ type: "done" });
          controller.close();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "An error occurred";
          logger.error({ err: error }, "Arena streaming error");
          writeEvent({ type: "error", error: errorMessage });
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    logger.error({ err: error }, "Arena stream error");
    return handleError(error, "Arena stream");
  }
}
