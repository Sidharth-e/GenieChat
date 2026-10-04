import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { config } from "@/lib/config";
import { getModel } from "@/lib/langchain/model-factory";

/**
 * The extraction model, built in one place.
 *
 * `graph-store.ts` holds no model wiring, so the id, the provider mapping and
 * the options live here and every caller of the extractor gets the same model.
 * It reads `config` rather than `process.env`, per the project's rule that
 * `lib/config.ts` is the single source of truth for service configuration —
 * which also makes this module reachable only from inside the app, since
 * `config` carries the `"server-only"` guard.
 */
export function createMemoryModel(): BaseChatModel {
  return getModel(config.memory.extractionModel);
}
