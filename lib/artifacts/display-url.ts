import { isStorageRef } from "@/lib/storage/ref";

export interface ArtifactDisplayUrl {
  /** What to point an `<img>`, or a new tab, at. */
  url: string;
  /** Whether that URL may be rendered at all. */
  usable: boolean;
}

/**
 * Turns a stored artifact URL into something the browser can load.
 *
 * The stored value is normally a presigned `https` URL, but the store falls
 * back to the bare `s3://` ref when signing fails or the ref belongs to another
 * user — and that fallback is routed through the ownership-checking proxy route
 * rather than handed to `<img>` directly.
 *
 * `usable` is an allowlist, not a non-empty test: a row whose value is neither
 * a ref nor `http(s)` (a bare `generated-images/…` path, say) must fall back to
 * the type icon rather than render a broken `<img>` or offer "Open in new tab".
 *
 * Shared by the grid card and the list row so the two views cannot disagree
 * about what is renderable.
 */
/**
 * The in-app URL that serves a stored ref.
 *
 * The ownership-checking proxy, which presigns on demand — so a URL built from a
 * ref outlives any single signature, which is what makes it safe to write into a
 * message that will be re-read tomorrow.
 */
export function storageDownloadUrl(ref: string): string {
  return `/api/storage/download?ref=${encodeURIComponent(ref)}`;
}

export function resolveArtifactDisplayUrl(
  storedUrl: string,
): ArtifactDisplayUrl {
  const isRef = isStorageRef(storedUrl);
  return {
    url: isRef ? storageDownloadUrl(storedUrl) : storedUrl,
    usable: isRef || /^https?:\/\//.test(storedUrl),
  };
}
