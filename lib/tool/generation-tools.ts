/**
 * The two media-generation tools — image and video — kept out of
 * `default-tools.ts` because both are factories needing the caller's identity,
 * and because they share a whole delivery path: generate, upload the bytes,
 * return a `s3://` ref plus the markdown that renders it.
 *
 * Neither publishes bytes through the tool result. That result is both streamed
 * to the client and persisted in the thread document, and an image is megabytes
 * of base64 and a video is more; routing them through the artifact envelope
 * would put them on the wire and in Mongo twice. So each tool uploads its own
 * bytes and what travels is the ref.
 *
 * The two differ in exactly one place: an image arrives as base64 and is
 * rendered by an `![]()` the model echoes, while a video is polled out of a job
 * and rendered by a fence (see `lib/video.ts`) — see
 * [Media Generation (OpenRouter)](#media-generation-openrouter).
 */
import { tool } from "langchain";
import * as z from "zod";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { STORAGE_BUCKETS } from "@/constants/storage";
import { storageDownloadUrl } from "@/lib/artifacts/display-url";
import { keyForUser } from "@/lib/storage/ref";
import { videoFenceMarkdown } from "@/lib/video";
import { generateId } from "@/lib/utils";

/**
 * Generates an image and stores it, returning the markdown that renders it.
 *
 * The reply carries a markdown image pointing at the proxy URL — which presigns
 * afresh on every read, so the picture survives the TTL on any one signature.
 */
export const createGenerateImageTool = (userId?: string, chatId?: string) =>
  tool(
    async (input) => {
      if (!userId) {
        return JSON.stringify({
          error: "Image generation needs an authenticated user.",
        });
      }

      const model = input.model?.trim() || config.generation.defaultImageModel;

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
          .enum(config.generation.imageAspectRatios)
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

/**
 * Generates a video and stores it, returning the fence that renders it.
 *
 * Slow by nature: the provider runs the generation as a job, so this call holds
 * the conversation open for as long as the job takes and gives up past a fixed
 * budget rather than holding it indefinitely. The model is told what happened,
 * including the job id when one was abandoned, so a failure reads as a slow
 * generation rather than a broken tool.
 */
export const createGenerateVideoTool = (userId?: string, chatId?: string) =>
  tool(
    async (input) => {
      if (!userId) {
        return JSON.stringify({
          error: "Video generation needs an authenticated user.",
        });
      }

      const model = input.model?.trim() || config.generation.defaultVideoModel;

      try {
        const [{ generateVideo }, { putObject }] = await Promise.all([
          import("@/lib/generation"),
          import("@/lib/storage"),
        ]);

        const result = await generateVideo({
          model,
          prompt: input.prompt,
          aspectRatio: input.aspect_ratio,
          durationSeconds: input.duration_seconds,
        });

        // Named `.mp4` from the provider's declared type rather than a table of
        // extensions: this endpoint emits mp4 for every model behind it, and a
        // suffix the player cannot read is worse than none.
        const uploaded = await putObject(
          STORAGE_BUCKETS.generatedVideos,
          keyForUser(userId, "video", `${generateId()}.mp4`),
          result.bytes,
          result.mediaType,
        );

        if (uploaded.status !== "OK") {
          logger.error({ err: uploaded }, "Failed to store a generated video");
          return JSON.stringify({
            error: "The video was generated but could not be stored.",
          });
        }

        const url = storageDownloadUrl(uploaded.response);

        return JSON.stringify({
          success: true,
          url,
          model,
          duration_seconds: input.duration_seconds ?? null,
          aspect_ratio: input.aspect_ratio ?? "auto",
          markdown: videoFenceMarkdown(input.prompt, url),
          note: "Include the markdown field verbatim in your reply so the video renders for the user. Do not describe the clip as unavailable — it has already been generated and stored.",
          _artifact: {
            type: "video",
            title: input.prompt.slice(0, 120),
            url: uploaded.response,
            metadata: {
              model,
              durationSeconds: input.duration_seconds ?? null,
              aspectRatio: input.aspect_ratio ?? null,
              costUsd: result.costUsd ?? null,
            },
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, model }, "Video generation failed");
        return JSON.stringify({
          error: `Failed to generate the video: ${message}`,
        });
      }
    },
    {
      name: "generate_video",
      description:
        "Generate a short video clip from a text prompt and post it into the conversation. Use this whenever the user asks for a video, an animation, a clip or moving footage. Generation takes anywhere from thirty seconds to a few minutes, and the call does not return until the video is ready or the wait gives out. The result carries a `markdown` field holding the video; include that markdown verbatim in your reply so the clip is shown.",
      schema: z.object({
        prompt: z
          .string()
          .min(1)
          .describe(
            "What to film, described fully — subject, action, camera movement, style and lighting — rather than a filename. Say what should move, not just what is in frame.",
          ),
        aspect_ratio: z
          .enum(config.generation.videoAspectRatios)
          .optional()
          .describe(
            "Optional aspect ratio. Omit unless the request implies a shape, so the model's default stands.",
          ),
        duration_seconds: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Optional clip length in seconds. Omit unless the user names a length, so the model's default stands.",
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Optional video-model slug overriding the default. Set this only when the user names a specific model.",
          ),
      }),
    },
  );
