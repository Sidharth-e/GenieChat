/**
 * The image model a generation falls back to when the caller names none.
 *
 * One curated constant rather than a picker: the OpenRouter catalogue is large
 * and its slugs churn, and the models differ mainly in capability — reference
 * images, output format, resolution tiers — not in taste, which is the thing a
 * user-facing selector would be for. The tool still accepts a `model` argument,
 * so the model can override when the request names a specific one.
 */
export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image";

/**
 * Image generation outruns a chat completion — a large prompt on a capable
 * model is tens of seconds, and the provider fans out to a backend — so this
 * sits well above the embedding client's 60s.
 */
export const GENERATED_IMAGE_TIMEOUT_MS = 180_000;

/**
 * The aspect ratios the tool offers.
 *
 * Deliberately short. Providers clamp a requested ratio to their own subset
 * rather than rejecting it, so a longer list would advertise ratios some models
 * cannot honour, and the model reads this list as its options.
 */
export const IMAGE_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
