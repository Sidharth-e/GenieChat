/**
 * Public surface for media generation.
 *
 * `response.ts` and `video.ts` are pure and unit-tested; `client.ts` performs
 * I/O and is not. Only what callers outside this module use is re-exported — the
 * tools take `generateImage`, `generateVideo` and `extensionForMediaType`, and
 * the `parse*` functions are imported from their own modules directly by the
 * tests that exercise them.
 *
 * The video *fence* is not here: `lib/video.ts` owns it, because the renderer
 * that reads one runs in the browser and this module is `"server-only"`.
 */
export { generateImage, generateVideo } from "./client";
export type { GenerateImageParams, GenerateVideoParams, GeneratedVideo } from "./client";
export { extensionForMediaType, mediaTypeForExtension } from "./response";
export { markdownImageFor } from "./markdown";
export type { GeneratedImage, ImageGenerationResult } from "./response";
