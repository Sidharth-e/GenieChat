import { Message } from "@/lib/types";

export function extractLatestCanvasCode(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.toolCalls) continue;
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
  return null;
}
