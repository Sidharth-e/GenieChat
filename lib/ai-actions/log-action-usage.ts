"use server";

import { logger } from "@/lib/logger";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";
import { AiUsageStore } from "@/lib/mongodb/ai-usage-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";

export async function logActionUsage(
  userId: string | undefined,
  action: string,
  tokens: { prompt: number; completion: number } | undefined,
  durationMs: number,
  response?: string,
): Promise<void> {
  if (!userId || !isDatabaseConfigured()) return;
  try {
    await new AiUsageStore().logUsage({
      userId,
      action,
      source: "action",
      model: DEFAULT_MODEL_ID,
      tokens,
      durationMs,
      response,
    });
  } catch (err) {
    logger.warn({ err }, "[Action] Failed to log usage to the database");
  }
}
