import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { Message, DocumentReference, ImageReference } from "@/lib/types";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ApiError } from "@/lib/api-utils";
import {
  hydrateMessages,
  processDocuments,
  processImages,
  getHistoricalImages,
} from "@/lib/api/stream-helper";
import { chatService } from "@/lib/langchain/chat-service";
import { getModelMaxInputChars } from "@/lib/langchain/model-config";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { storageRefSchema } from "@/lib/storage/ref";
import { z } from "zod";
import { generateId } from "../utils";

const attachmentSchema = z.object({
  id: z.string().min(1).max(128),
  fileName: z.string().min(1).max(260),
  ref: storageRefSchema,
  mimeType: z.string().min(1).max(255).optional(),
});

const imageAttachmentSchema = attachmentSchema.extend({
  mimeType: z.string().min(1).max(255),
});

const streamRequestSchema = z.object({
  threadId: z.string().min(1).max(128).optional(),
  message: z.string(),
  model: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  regenerateMessageId: z.string().min(1).max(128).optional(),
  editMessageId: z.string().min(1).max(128).optional(),
  agentId: z.string().min(1).max(128).optional(),
  systemPrompt: z.string().max(16000).optional(),
  forceWebSearch: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(["off", "low", "medium", "high"]).optional(),
  documents: z.array(attachmentSchema).max(10).optional(),
  images: z.array(imageAttachmentSchema).max(8).optional(),
});

type StreamRequestBody = z.infer<typeof streamRequestSchema>;

export interface StreamContext {
  user: {
    id: string;
    name: string;
    email: string;
  };
  requestBody: StreamRequestBody;
  threadId: string;
  isNewThread: boolean;
  messages: Message[];
  imagesForAI: { base64Data: string; mimeType: string }[];
  isFirstMessage: boolean;
  isRegeneration: boolean;
  regenerateMessageId?: string;
  pairedUserVersionId?: string;
  pairedAssistantVersionId?: string;
  savedUserMessageId?: string;
}

export class StreamPipeline {
  /**
   * Validates the request and authenticates the user.
   */
  static async validateRequest(req: NextRequest) {
    const user = await getSessionUser();
    if (!user) {
      throw new ApiError("Unauthorized", 401);
    }

    const rateLimit = await checkRateLimit(req, {
      namespace: "stream",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      throw new ApiError(
        `Too many stream requests. Retry after ${rateLimit.retryAfterSeconds}s`,
        429,
        "RATE_LIMITED",
      );
    }

    const parsed = streamRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid request";
      throw new ApiError(firstError, 400, "INVALID_REQUEST");
    }

    const body: StreamRequestBody = {
      ...parsed.data,
      message: parsed.data.message.trim(),
    };

    const hasAttachments =
      (body.documents && body.documents.length > 0) ||
      (body.images && body.images.length > 0);
    if (!body.message && !hasAttachments) {
      throw new ApiError("Message or attachment is required", 400, "INVALID_REQUEST");
    }

    const modelMaxInputChars = getModelMaxInputChars(body.model);
    if (body.message.length > modelMaxInputChars) {
      throw new ApiError(
        `Message is too long for ${body.model}. Maximum ${modelMaxInputChars.toLocaleString()} characters.`,
        400,
        "INVALID_REQUEST",
      );
    }

    return { user, body };
  }

  /**
   * Handles thread creation or retrieval and verifies ownership.
   */
  static async initializeThread(
    userId: string,
    userName: string,
    userEmail: string,
    body: StreamRequestBody,
    isMultiAgent: boolean = false,
    threadOptions?: { isSwarm?: boolean; swarmAgentIds?: string[] },
  ): Promise<{ threadId: string; isNewThread: boolean }> {
    const { threadId, model, agentId } = body;
    let currentThreadId = threadId;
    let isNewThread = false;

    if (!currentThreadId) {
      // Create new thread
      const newThread = await store.createThread(
        userId,
        model,
        agentId,
        isMultiAgent,
        undefined,
        undefined,
        userName,
        userEmail,
        threadOptions,
      );
      currentThreadId = newThread.id;
      isNewThread = true;
    } else {
      const existingThread = await store.getThread(currentThreadId);

      if (!existingThread) {
        const newThread = await store.createThread(
          userId,
          model,
          agentId,
          isMultiAgent,
          undefined,
          currentThreadId,
          userName,
          userEmail,
          threadOptions,
        );
        currentThreadId = newThread.id;
        isNewThread = true;
      } else if (existingThread.userId !== userId) {
        throw new ApiError("Forbidden", 403);
      }
    }

    return { threadId: currentThreadId, isNewThread };
  }

  /**
   * Processes uploaded documents and images, and retrieves historical images.
   */
  static async processAssets(
    body: StreamRequestBody,
    userId: string,
    existingMessages: Message[],
    logPrefix: string = "[StreamPipeline]",
  ) {
    const documents = body.documents ?? [];
    const images = body.images ?? [];

    // Process documents
    const processedDocuments = await processDocuments(
      documents,
      userId,
      logPrefix,
    );

    // Process images
    const { processedImages, imagesForAI: newImagesForAI } =
      await processImages(images, userId, logPrefix);

    // Historical images from context
    const historicalImages = await getHistoricalImages(
      existingMessages,
      userId,
      logPrefix,
    );

    const imagesForAI = [...newImagesForAI, ...historicalImages];

    return { processedDocuments, processedImages, imagesForAI };
  }

  /**
   * Creates, saves, and hydrates the user message.
   */
  static async saveUserMessage(
    userId: string,
    userName: string,
    userEmail: string,
    threadId: string,
    body: StreamRequestBody,
    assets: {
      processedDocuments: DocumentReference[];
      processedImages: ImageReference[];
    },
    existingMessages: Message[],
    pairedAssistantVersionId: string,
    logPrefix: string = "[StreamPipeline]",
  ): Promise<{
    messages: Message[];
    userVersionId: string;
    savedUserMessageId: string;
  }> {
    const { message, model } = body;
    const { processedDocuments, processedImages } = assets;
    const userVersionId = generateId();

    const savedUserMessage = await store.addMessage(threadId, {
      threadId,
      userId,
      userName,
      userEmail,
      role: "user",
      content: message,
      model,
      documents: processedDocuments.length > 0 ? processedDocuments : undefined,
      images: processedImages.length > 0 ? processedImages : undefined,
      versionId: userVersionId,
      pairedAssistantVersionId,
    });

    const rawMessages: Message[] = [...existingMessages, savedUserMessage];
    return {
      messages: await hydrateMessages(rawMessages, userId, logPrefix),
      userVersionId,
      savedUserMessageId: savedUserMessage.id,
    };
  }

  /**
   * Orchestrates the entire setup phase: Auth -> Thread -> Assests -> Message Save
   */
  static async prepareStreamContext(
    req: NextRequest,
    isMultiAgent: boolean = false,
    logPrefix: string = "[StreamPipeline]",
  ): Promise<StreamContext> {
    // 1. Validate & Auth
    const { user, body } = await StreamPipeline.validateRequest(req);

    // 2. Thread Management
    const { threadId, isNewThread } = await StreamPipeline.initializeThread(
      user.id,
      user.name,
      user.email,
      body,
      isMultiAgent,
    );

    // 3. Get Context
    const existingMessages = await store.getMessages(threadId);
    const isRegeneration = Boolean(body.regenerateMessageId);
    const isEdit = Boolean(body.editMessageId);
    const regenerateMessageId = body.regenerateMessageId;
    const editMessageId = body.editMessageId;

    if (isEdit) {
      if (isNewThread || !editMessageId) {
        throw new ApiError(
          "Edit requires an existing thread and target message",
          400,
          "INVALID_REQUEST",
        );
      }

      let targetMessageIndex = existingMessages.findIndex(
        (msg) => msg.id === editMessageId,
      );
      if (targetMessageIndex < 0) {
        const targetMessage = await store.getMessage(threadId, editMessageId);
        if (targetMessage) {
          existingMessages.push(targetMessage);
          existingMessages.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          targetMessageIndex = existingMessages.findIndex(
            (msg) => msg.id === editMessageId,
          );
        }
      }
      if (targetMessageIndex < 0) {
        throw new ApiError("Target message not found for editing", 404);
      }

      const targetMessage = existingMessages[targetMessageIndex];
      if (targetMessage.role !== "user") {
        throw new ApiError(
          "Only user messages can be edited",
          400,
          "INVALID_REQUEST",
        );
      }

      // Generate IDs to pair the user version and the new assistant version
      const newAssistantVersionId = generateId();
      
      // Append a new version to the user message
      const updatedUserMessage = await store.appendMessageVersion(
        threadId,
        editMessageId,
        {
          content: body.message,
          model: body.model,
          pairedAssistantVersionId: newAssistantVersionId,
        }
      );

      if (!updatedUserMessage) {
        throw new ApiError("Failed to update user message", 500);
      }

      // Replace the user message in our local context array
      existingMessages[targetMessageIndex] = updatedUserMessage;

      // The new context includes everything up to the edited message
      const contextMessages = existingMessages.slice(0, targetMessageIndex + 1);
      const messages = await hydrateMessages(contextMessages, user.id, logPrefix);
      const imagesForAI = await getHistoricalImages(
        contextMessages,
        user.id,
        logPrefix,
      );

      // We need to identify if there's an existing assistant message immediately after this user message
      // If there is, we regenerate it (by passing it as regenerateMessageId). 
      // If there isn't, we will generate a new assistant message from scratch.
      const nextMessage = existingMessages[targetMessageIndex + 1];
      let assistantMessageToRegenerate = undefined;
      
      if (nextMessage && nextMessage.role === "assistant") {
         assistantMessageToRegenerate = nextMessage.id;
      }

      return {
        user,
        requestBody: body,
        threadId,
        isNewThread: false,
        messages,
        imagesForAI,
        isFirstMessage: false,
        isRegeneration: true, // We act as if it's a regeneration of the assistant message
        regenerateMessageId: assistantMessageToRegenerate,
        // We pass this extra field to inform the generation loop about the pair
        pairedUserVersionId: updatedUserMessage.versions[updatedUserMessage.activeVersionIndex].versionId,
        pairedAssistantVersionId: newAssistantVersionId, // The ID the newly generated assistant version should use
      };
    }

    if (isRegeneration) {
      if (isNewThread || !regenerateMessageId) {
        throw new ApiError(
          "Regeneration requires an existing thread and target message",
          400,
          "INVALID_REQUEST",
        );
      }

      if ((body.documents?.length || 0) > 0 || (body.images?.length || 0) > 0) {
        throw new ApiError(
          "Attachments are not supported during regeneration",
          400,
          "INVALID_REQUEST",
        );
      }

      const targetMessageIndex = existingMessages.findIndex(
        (msg) => msg.id === regenerateMessageId,
      );
      if (targetMessageIndex < 0) {
        throw new ApiError("Target message not found for regeneration", 404);
      }

      const targetMessage = existingMessages[targetMessageIndex];
      if (targetMessage.role !== "assistant") {
        throw new ApiError(
          "Regeneration target must be an assistant message",
          400,
          "INVALID_REQUEST",
        );
      }
      if (targetMessageIndex !== existingMessages.length - 1) {
        throw new ApiError(
          "Only the latest assistant message can be regenerated",
          400,
          "INVALID_REQUEST",
        );
      }

      const contextMessages = existingMessages.slice(0, targetMessageIndex);
      const messages = await hydrateMessages(contextMessages, user.id, logPrefix);
      const imagesForAI = await getHistoricalImages(
        contextMessages,
        user.id,
        logPrefix,
      );

      // Extract the pairedUserVersionId from the preceding user message
      const precedingUserMsg = existingMessages[targetMessageIndex - 1];
      let pairedUserVersionId = undefined;
      if (precedingUserMsg && precedingUserMsg.role === "user" && precedingUserMsg.versions) {
          pairedUserVersionId = precedingUserMsg.versions[precedingUserMsg.activeVersionIndex]?.versionId;
      }

      return {
        user,
        requestBody: body,
        threadId,
        isNewThread: false,
        messages,
        imagesForAI,
        isFirstMessage: false,
        isRegeneration: true,
        regenerateMessageId,
        pairedUserVersionId,
      };
    }

    // 4. Process Assets
    const assets = await StreamPipeline.processAssets(
      body,
      user.id,
      existingMessages,
      logPrefix,
    );

    const pairedAssistantVersionId = generateId();

    // 5. Save & Hydrate User Message
    const { messages, userVersionId, savedUserMessageId } =
      await StreamPipeline.saveUserMessage(
      user.id,
      user.name,
      user.email,
      threadId,
      body,
      assets,
      existingMessages,
      pairedAssistantVersionId,
      logPrefix,
    );

    return {
      user,
      requestBody: body,
      threadId,
      isNewThread,
      messages,
      imagesForAI: assets.imagesForAI,
      isFirstMessage: existingMessages.length === 0,
      isRegeneration: false,
      regenerateMessageId: undefined,
      pairedAssistantVersionId,
      pairedUserVersionId: userVersionId,
      savedUserMessageId,
    };
  }

  /**
   * Generates a title for the thread if it's the first message.
   * Can be called after the stream is done or concurrently.
   */
  static async generateTitleIfNeeded(
    threadId: string,
    isFirstMessage: boolean,
    encoder: TextEncoder,
    controller: ReadableStreamDefaultController,
  ) {
    if (isFirstMessage) {
      try {
        const allMessages = await store.getMessages(threadId);
        const title = await chatService.generateTitle(allMessages);
        await store.updateThread(threadId, { title });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "title", title })}\n\n`,
          ),
        );
      } catch (e) {
        logger.error("Failed to generate title:", e);
      }
    }
  }
}
