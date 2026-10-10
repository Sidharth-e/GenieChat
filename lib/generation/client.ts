import "server-only";
import axios, { type AxiosInstance } from "axios";
import { config } from "@/lib/config";
import { parseImageResponse, type ImageGenerationResult } from "./response";
import { parseVideoJob, parseVideoSubmission, videoJobOutcome } from "./video";

/**
 * The OpenRouter clients.
 *
 * Mirrors `lib/embeddings/index.ts`'s client: one instance per endpoint, auth
 * attached by an interceptor so a missing key surfaces as a thrown error rather
 * than an unauthenticated request, and the provider's own error message
 * unwrapped so a caller sees why a generation failed instead of an axios
 * envelope.
 *
 * Two instances rather than one because the two endpoints want opposite
 * timeouts. An image request *is* the generation, so its timeout has to cover
 * the whole thing; a video poll is a fast request inside a long loop, and giving
 * each poll the image budget would mean one stalled poll holding the tool call
 * for three minutes past the point it should have given up.
 */
function createOpenRouterClient(timeoutMs: number): AxiosInstance {
  const client = axios.create({
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
    headers: {
      "Content-Type": "application/json",
    },
  });

  client.interceptors.request.use((reqConfig) => {
    const apiKey = config.openrouter.apiKey;
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key not configured. Set OPENROUTER_API_KEY.",
      );
    }
    reqConfig.headers.Authorization = `Bearer ${apiKey}`;
    return reqConfig;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      const message =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message ||
        "OpenRouter request failed";
      return Promise.reject(new Error(message));
    },
  );

  return client;
}

export const openRouterImageClient = createOpenRouterClient(
  config.generation.imageTimeoutMs,
);

export const openRouterVideoClient = createOpenRouterClient(
  config.generation.videoTimeoutMs,
);

export interface GenerateImageParams {
  model: string;
  prompt: string;
  /** Clamped by the provider to the ratios its model supports. */
  aspectRatio?: string;
}

/**
 * Generates one image and returns its bytes.
 *
 * A response carrying no usable image is an error rather than an empty result:
 * the caller asked for a picture, and "succeeded with nothing" would render as a
 * reply that silently lacks the thing it promised.
 */
export async function generateImage(
  params: GenerateImageParams,
): Promise<ImageGenerationResult> {
  const response = await openRouterImageClient.post("/images", {
    model: params.model,
    prompt: params.prompt,
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
  });

  const parsed = parseImageResponse(response.data);
  if (!parsed) {
    throw new Error("OpenRouter returned no image for this prompt.");
  }

  return parsed;
}

export interface GenerateVideoParams {
  model: string;
  prompt: string;
  /** Clamped by the provider to the ratios its model supports. */
  aspectRatio?: string;
  /** Length in seconds. The provider defaults when this is omitted. */
  durationSeconds?: number;
}

export interface GeneratedVideo {
  /** The video bytes, as the content endpoint returned them. */
  bytes: Buffer;
  /** e.g. `video/mp4`, or `video/mp4` where the response declared nothing. */
  mediaType: string;
  /** Provider-reported cost in USD, when the completed job carried one. */
  costUsd?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submits a video job and polls it until it finishes, then fetches the bytes.
 *
 * The whole job is held inside this one call, which is the shape the tool call
 * needs but not the shape the provider offers: generation runs for minutes, so a
 * stalled or abandoned job is bounded by `config.generation.videoMaxWaitMs`
 * rather than by any single request. Past that the job id goes into the error,
 * so a timeout is legible — the video may well still be generating, and the
 * caller can say which job it gave up on.
 *
 * The wait is deliberately *not* recoverable: nothing here holds the job for a
 * later reader, so a timeout loses the generation. See
 * [Media Generation (OpenRouter)](#media-generation-openrouter).
 */
export async function generateVideo(
  params: GenerateVideoParams,
): Promise<GeneratedVideo> {
  const submission = parseVideoSubmission(
    (
      await openRouterVideoClient.post("/videos", {
        model: params.model,
        prompt: params.prompt,
        ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
        ...(params.durationSeconds ? { duration: params.durationSeconds } : {}),
      })
    ).data,
  );

  if (!submission) {
    throw new Error("OpenRouter returned no video job for this prompt.");
  }

  const deadline = Date.now() + config.generation.videoMaxWaitMs;

  // Polled before the first sleep, not after: a job the provider rejects
  // immediately — an unsupported model, a bad ratio — should fail now rather
  // than after an interval of waiting for an answer that is already there.
  for (;;) {
    const job = parseVideoJob(
      (
        await openRouterVideoClient.get(
          `/videos/${encodeURIComponent(submission.id)}`,
        )
      ).data,
    );

    if (!job) {
      throw new Error(
        `OpenRouter returned no status for video job ${submission.id}.`,
      );
    }

    const outcome = videoJobOutcome(job);

    if (outcome.kind === "failed") {
      throw new Error(outcome.reason);
    }

    if (outcome.kind === "ready") {
      // The content URLs are unsigned, so this request carries the API key like
      // any other — the interceptor supplies it.
      const content = await openRouterVideoClient.get(outcome.contentUrl, {
        responseType: "arraybuffer",
      });
      const contentType = content.headers["content-type"];

      return {
        bytes: Buffer.from(content.data),
        mediaType:
          typeof contentType === "string" && contentType.length > 0
            ? contentType
            : "video/mp4",
        costUsd: outcome.costUsd,
      };
    }

    if (Date.now() >= deadline) {
      const minutes = Math.round(config.generation.videoMaxWaitMs / 60_000);
      throw new Error(
        `The video was still rendering after ${minutes} minutes, so job ${submission.id} was abandoned. It may still finish on OpenRouter's side.`,
      );
    }

    await delay(config.generation.videoPollIntervalMs);
  }
}
