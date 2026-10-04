"use client";

/**
 * The graph's colours, resolved from the design tokens at render time.
 *
 * A canvas cannot take `var(--chart-1)` — `ctx.fillStyle` needs a concrete
 * colour — so the tokens are read off the document element. That read only sees
 * the values the theme in force has applied, and every one of these tokens has a
 * different value in the dark blocks, so the effect re-runs on the resolved
 * theme and a cached colour from the previous theme is never drawn.
 *
 * The returned map is keyed by token name, so callers key on exactly the names
 * `MEMORY_GRAPH_NODE_TOKEN` and `MEMORY_GRAPH_EDGE_STYLE` carry.
 */
import * as React from "react";
import { useTheme } from "@/components/providers/theme-provider";
import {
  MEMORY_GRAPH_EDGE_STYLE,
  MEMORY_GRAPH_NODE_TOKEN,
} from "@/lib/memory/graph-view";

/**
 * Tokens the renderer needs that no node or edge style names — the label colour.
 */
const SUPPORTING_TOKENS = ["--text-secondary"];

const TOKENS = Array.from(
  new Set([
    ...Object.values(MEMORY_GRAPH_NODE_TOKEN),
    ...Object.values(MEMORY_GRAPH_EDGE_STYLE).map((style) => style.token),
    ...SUPPORTING_TOKENS,
  ]),
);

/** The label colour, beside the tokens it sits among so the renderer agrees. */
export const MEMORY_GRAPH_LABEL_TOKEN = "--text-secondary";

function readPalette(): Record<string, string> {
  // No document while rendering on the server, and no tokens to read before the
  // stylesheet applies. An empty map is the honest answer; the canvas falls back
  // to a neutral colour until the first client paint resolves the real values.
  if (typeof document === "undefined") return {};
  const styles = getComputedStyle(document.documentElement);
  const palette: Record<string, string> = {};
  for (const token of TOKENS) {
    const value = styles.getPropertyValue(token).trim();
    if (value) palette[token] = value;
  }
  return palette;
}

export function useMemoryGraphPalette(): Record<string, string> {
  const { resolvedTheme } = useTheme();
  const [palette, setPalette] = React.useState<Record<string, string>>({});

  // `resolvedTheme` is the dependency rather than a mount effect alone: the
  // theme provider swaps the class on `documentElement` and then updates this
  // value, so the re-read happens after the new block is in force.
  React.useEffect(() => {
    setPalette(readPalette());
  }, [resolvedTheme]);

  return palette;
}
