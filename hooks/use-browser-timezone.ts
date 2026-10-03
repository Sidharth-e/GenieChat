"use client";

import { useSyncExternalStore } from "react";

/**
 * The zone the browser is in, resolved without a hydration mismatch.
 *
 * A `once` cadence carries no zone of its own, so it has to render in the
 * viewer's -- and the viewer's zone is knowable only on the client. Reading it
 * straight from `Intl` during render is what makes this awkward: the server pass
 * would resolve the server's zone and the client pass the browser's, so the two
 * would disagree about the text they render. In development they usually agree
 * by accident, because the dev server runs on the same machine as the browser;
 * in production the server is UTC and every non-UTC viewer mismatches.
 *
 * `useSyncExternalStore` is the way out because it takes the two answers
 * separately: React renders the server snapshot through hydration and then
 * re-renders from the client snapshot. That needs no effect, so it does not trip
 * `react-hooks/set-state-in-effect`, and it keeps no state -- the browser's zone
 * does not change while the tab is open.
 *
 * Both snapshots return a string, which is what makes them safe as snapshots: a
 * snapshot returning a fresh object every call would re-render forever.
 */
export function useBrowserTimezone(): string {
  return useSyncExternalStore(subscribeNever, browserTimezone, serverTimezone);
}

/** Nothing to subscribe to: a tab does not change timezone while it is open. */
function subscribeNever(): () => void {
  return () => {};
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // A runtime that cannot resolve a zone still has to render something, and
    // UTC is the zone the rest of the subsystem falls back to.
    return "UTC";
  }
}

const serverTimezone = (): string => "UTC";
