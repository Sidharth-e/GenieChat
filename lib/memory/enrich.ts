import "server-only";
import { getModel } from "@/lib/langchain/model-factory";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { MemoryGraphStore } from "./graph-store";
import {
  extractEnrichment,
  type ExtractionNeighbour,
} from "./llm-extraction";

/**
 * One memory, enriched. Never throws and never rejects: the caller fires it
 * detached, so its failure has to be a return value the caller can ignore.
 *
 * `false` covers both "the model answered with something unusable" and "the
 * model or the database was unreachable". Both leave `enrichedAt` null, which
 * is the one state the sweep knows how to pick up — the distinction is in the
 * log, not in the return value.
 */
export async function enrichMemory(
  graphStore: MemoryGraphStore,
  memoryId: string,
  userId: string,
  content: string,
  neighbours: ExtractionNeighbour[],
): Promise<boolean> {
  try {
    const model = getModel(config.memory.extractionModel);
    const enrichment = await extractEnrichment(model, content, neighbours);

    if (!enrichment) {
      // Never a throw and never a repair: a guessed edge is worse than a
      // missing one, so malformed output means "nothing extracted".
      logger.warn(
        { memoryId, userId },
        "Enrichment output failed validation; discarding",
      );
      return false;
    }

    await graphStore.applyEnrichment(memoryId, userId, enrichment);
    return true;
  } catch (error) {
    logger.error({ err: error, memoryId, userId }, "Memory enrichment failed");
    return false;
  }
}
