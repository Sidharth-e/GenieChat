/**
 * The home screen's usage totals.
 *
 * The reads themselves live on the stores that own each collection; what
 * belongs here is the part worth testing without a database -- the window's
 * bound, and the shape a grouped aggregation row collapses into. A `$group`
 * with `_id: null` returns no rows at all when nothing matched, so every
 * summary has to answer for that case rather than reading `rows[0]` blindly.
 */

/**
 * How far back "this week" reaches. A rolling window rather than a calendar
 * week: it needs no locale and no timezone, so the same numbers are reported
 * wherever the reader happens to be.
 */
export const HOME_STATS_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant one window before `now`, as an ISO 8601 string.
 *
 * A string rather than a `Date` because that is how these dates are stored, and
 * ISO 8601 sorts chronologically as a string -- so this is a valid bound by
 * comparison. Handing a `Date` to a query over stored strings would be
 * type-bracketed and match nothing.
 */
export function windowStartIso(
  now: Date,
  days: number = HOME_STATS_WINDOW_DAYS,
): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

export interface ThreadUsageSummary {
  total: number;
  messages: number;
}

/** One grouped row from the thread aggregation. `$sum` omits a field no document contributed to. */
export interface ThreadUsageRow {
  threads?: number;
  messages?: number;
}

export function summarizeThreadUsage(
  rows: ThreadUsageRow[],
): ThreadUsageSummary {
  const row = rows[0];
  return { total: row?.threads ?? 0, messages: row?.messages ?? 0 };
}

export interface TokenUsageSummary {
  prompt: number;
  completion: number;
}

/** One grouped row from the token aggregation, summed across chat messages and AI actions alike. */
export interface TokenUsageRow {
  prompt?: number;
  completion?: number;
}

export function summarizeTokenUsage(rows: TokenUsageRow[]): TokenUsageSummary {
  const row = rows[0];
  return { prompt: row?.prompt ?? 0, completion: row?.completion ?? 0 };
}
