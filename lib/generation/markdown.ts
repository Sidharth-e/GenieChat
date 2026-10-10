/**
 * Builds the markdown image a reply carries for a generated picture.
 *
 * Its own pure helper because a prompt is arbitrary user text and this is the
 * point where that text becomes markdown syntax: a `]` in the prompt closes the
 * alt text early, and a newline ends the line, so a prompt like "a logo with
 * the text [ACME]" would truncate the image or leave a dangling bracket where
 * the picture should be. The URL needs no escaping — it is the proxy path with
 * the ref already percent-encoded, so it carries no `)` or space.
 */
export function markdownImageFor(prompt: string, url: string): string {
  const alt =
    prompt
      .replace(/[[\]\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Generated image";

  return `![${alt}](${url})`;
}
