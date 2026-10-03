/**
 * A query-string integer, clamped rather than rejected: a bad parameter gets a
 * page, not a 400.
 *
 * The `min` bound is not cosmetic. `Number(null)` is `0`, and `0` is finite and
 * not negative, so a clamp without a lower bound answers `0` for an *absent*
 * parameter -- and Mongo's `.limit(0)` means no limit, not "no rows". An omitted
 * `?limit` would then return the whole collection in one response body.
 *
 * A value below `min` falls back rather than clamping up to it, so `?limit=0` is
 * a page as well; `?offset=0` survives because its own `min` is 0.
 */
export function boundedInt(
  raw: string | null,
  { fallback, min, max }: { fallback: number; min: number; max: number },
): number {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(Math.floor(value), max);
}
