import "server-only";
import axios, { type AxiosInstance } from "axios";
import { config } from "@/lib/config";
import { GENERATED_IMAGE_TIMEOUT_MS } from "@/constants/generation";
import { parseImageResponse, type ImageGenerationResult } from "./response";

/**
 * The OpenRouter image client.
 *
 * Mirrors `lib/embeddings/index.ts`'s client: one instance, auth attached by an
 * interceptor so a missing key surfaces as a thrown error rather than an
 * unauthenticated request, and the provider's own error message unwrapped so a
 * caller sees why a generation failed instead of an axios envelope.
 */
export const openRouterImageClient: AxiosInstance = axios.create({
  baseURL: "https://openrouter.ai/api/v1",
  timeout: GENERATED_IMAGE_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

openRouterImageClient.interceptors.request.use((reqConfig) => {
  const apiKey = config.openrouter.apiKey;
  if (!apiKey) {
    throw new Error("OpenRouter API key not configured. Set OPENROUTER_API_KEY.");
  }
  reqConfig.headers.Authorization = `Bearer ${apiKey}`;
  return reqConfig;
});

openRouterImageClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      "OpenRouter image request failed";
    return Promise.reject(new Error(message));
  },
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
