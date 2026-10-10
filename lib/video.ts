/**
 * The ```` ```video ```` fence — the pure protocol shared by the tool that
 * writes one and the renderer that reads it.
 *
 * Out of `lib/generation/` on purpose: that module is `"server-only"` and parses
 * OpenRouter's own responses, while the renderer runs in the browser and only
 * ever sees the fence. Keeping the format here is what lets both sides agree on
 * it without the client importing the provider.
 *
 * Markdown has no video syntax — there is no `![]()` for it — so the reply
 * carries a fence instead, the same way a chart or a scan code does. The body is
 * JSON rather than a bare URL for the same reason `markdownImageFor` escapes its
 * alt text: the title comes from the user's prompt, and JSON is a container that
 * arbitrary text cannot break out of.
 */

export const VIDEO_FENCE_LANGUAGE = "video";

export interface VideoFence {
  /** Where to fetch the video — the storage proxy path, not a presigned URL. */
  url: string;
  /** Caption shown with the player. Absent when the prompt was empty. */
  title?: string;
}

/**
 * The markdown a reply carries for a generated video.
 *
 * The title is collapsed to one line and capped rather than escaped: a prompt is
 * a sentence or two of user text, and a player caption is not the place for all
 * of it. JSON handles whatever survives.
 */
export function videoFenceMarkdown(prompt: string, url: string): string {
  const title =
    prompt.replace(/\s+/g, " ").trim().slice(0, 120) || undefined;

  const body: VideoFence = { url, ...(title ? { title } : {}) };

  return ["```" + VIDEO_FENCE_LANGUAGE, JSON.stringify(body), "```"].join("\n");
}

/**
 * Parses a fence body into the video it names.
 *
 * Returns `null` for anything that is not a usable fence — malformed JSON, a
 * non-object, or no `url` to fetch. That is the caller's cue to say so: mid
 * stream the body is still arriving, so a skeleton is honest, but after the
 * stream ends a `null` is a malformed fence and a skeleton would pulse forever.
 */
export function parseVideoFence(content: string): VideoFence | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const { url, title } = parsed as { url?: unknown; title?: unknown };
  if (typeof url !== "string" || url.length === 0) return null;

  return {
    url,
    title: typeof title === "string" && title.length > 0 ? title : undefined,
  };
}
