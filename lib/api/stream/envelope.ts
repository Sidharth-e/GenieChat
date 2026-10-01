import type { TokenMeta } from "./events";

/** Matches the interval every route uses today. */
export const FLUSH_INTERVAL_MS = 10;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

/** Identity of a buffered token run — two tokens buffer together only if this matches. */
function metaKey(meta: TokenMeta | undefined): string {
  if (!meta) return "";
  return `${meta.agentId ?? ""}|${meta.agentName ?? ""}|${meta.parentToolCallId ?? ""}`;
}

export interface TokenBuffer {
  push(content: string, meta?: TokenMeta): void;
  flush(): void;
  hasPending(): boolean;
}

export function createTokenBuffer(options: {
  onFlush: (content: string, meta?: TokenMeta) => void;
  flushIntervalMs?: number;
  now?: () => number;
}): TokenBuffer {
  const flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  const now = options.now ?? Date.now;

  let pending = "";
  let pendingMeta: TokenMeta | undefined;
  let pendingKey = "";
  let lastFlushTime = now();

  const flush = () => {
    if (!pending) return;
    const content = pending;
    const meta = pendingMeta;
    pending = "";
    pendingMeta = undefined;
    pendingKey = "";
    lastFlushTime = now();
    options.onFlush(content, meta);
  };

  return {
    push(content: string, meta?: TokenMeta) {
      const key = metaKey(meta);

      // A different agent's text must never be emitted under this one's id.
      if (pending && key !== pendingKey) {
        flush();
      }

      pendingKey = key;
      pendingMeta = meta;
      pending += content;

      if (now() - lastFlushTime >= flushIntervalMs) {
        flush();
      }
    },
    flush,
    hasPending: () => pending.length > 0,
  };
}

export function createSseWriter(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): (payload: Record<string, unknown>) => void {
  return (payload) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };
}
