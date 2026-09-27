import { Message } from "@/lib/types";

const CANVAS_BLOCK_REGEX = /```(?:react-canvas|canvas)\n([\s\S]*?)```/g;

export function extractLatestCanvasCode(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    if (msg.content) {
      const matches = Array.from(msg.content.matchAll(CANVAS_BLOCK_REGEX));
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        if (lastMatch && lastMatch[1]) {
          return lastMatch[1].trim().replace(/\n$/, "");
        }
      }
    }

    if (msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const tc = msg.toolCalls[j];
        if (tc.name === "generate_canvas" && tc.result) {
          try {
            const parsed = JSON.parse(tc.result);
            if (parsed.react_canvas_code) return parsed.react_canvas_code;
          } catch {
            /* skip malformed */
          }
        }
      }
    }
  }
  return null;
}
