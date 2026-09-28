import {
  CHUNK_OVERLAP,
  CHUNK_SEPARATORS,
  CHUNK_SIZE,
} from "@/constants/knowledge";

/**
 * Cut a window at the last "nice" separator in it, so chunks break between
 * sentences or paragraphs rather than mid-word. Only a separator past the
 * midpoint of the window is used — an early one would make the chunk far
 * smaller than the budget and, with a large overlap, risk stalling progress.
 */
function cutAtSeparator(window: string): string {
  for (const separator of CHUNK_SEPARATORS) {
    if (!separator) continue;
    const index = window.lastIndexOf(separator);
    if (index > window.length / 2)
      return window.slice(0, index + separator.length);
  }
  return window;
}

export function chunkDocumentWithOverlap(
  content: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const text = (content ?? "").trim();
  if (!text) return [];
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const window = text.slice(start, end);
    const chunk = (end === text.length ? window : cutAtSeparator(window)).trim();
    if (chunk) chunks.push(chunk);

    if (end === text.length) break;
    // Advance by the chunk we actually emitted, minus the overlap. The floor of
    // 1 guarantees progress when overlap >= size, which would otherwise loop
    // forever on the same window.
    start += Math.max(chunk.length - overlap, 1);
  }

  return chunks;
}
