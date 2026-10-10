/**
 * Public surface for media generation.
 *
 * `response.ts` is pure and unit-tested; `client.ts` performs I/O and is not.
 * Only what callers outside this module use is re-exported — the tool takes
 * `generateImage` and `extensionForMediaType`, and `parseImageResponse` is
 * imported from `./response` directly by the tests that exercise it.
 */
export { generateImage } from "./client";
export { extensionForMediaType, mediaTypeForExtension } from "./response";
export { markdownImageFor } from "./markdown";
export type { GeneratedImage, ImageGenerationResult } from "./response";
