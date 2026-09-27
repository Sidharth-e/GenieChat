import { describe, it, expect } from "vitest";
import { extractLatestCanvasCode } from "@/lib/tool/canvas-utils";
import type { Message } from "@/lib/types";

function makeMsg(
  role: "user" | "assistant" | "system",
  content: string,
  toolCalls?: Message["toolCalls"],
): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    threadId: "t1",
    userId: "u1",
    userName: "Test",
    userEmail: "test@example.com",
    role,
    content,
    toolCalls,
    versions: [],
    activeVersionIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function canvasToolCall(code: string) {
  return {
    id: "tc1",
    name: "generate_canvas",
    arguments: { description: "test component" },
    result: JSON.stringify({ react_canvas_code: code }),
  };
}

describe("extractLatestCanvasCode", () => {
  it("returns null for empty messages", () => {
    expect(extractLatestCanvasCode([])).toBeNull();
  });

  it("returns null when no canvas tool calls exist", () => {
    const messages = [
      makeMsg("user", "hello"),
      makeMsg("assistant", "hi there"),
    ];
    expect(extractLatestCanvasCode(messages)).toBeNull();
  });

  it("extracts code from a single canvas tool call", () => {
    const code = "export default function App() { return <div>Hello</div>; }";
    const messages = [
      makeMsg("user", "make a component"),
      makeMsg("assistant", "", [canvasToolCall(code)]),
    ];
    expect(extractLatestCanvasCode(messages)).toBe(code);
  });

  it("returns the latest canvas code when multiple versions exist", () => {
    const codeV1 = "export default function App() { return <div>V1</div>; }";
    const codeV2 = "export default function App() { return <div>V2</div>; }";
    const messages = [
      makeMsg("user", "make a component"),
      makeMsg("assistant", "", [canvasToolCall(codeV1)]),
      makeMsg("user", "change it"),
      makeMsg("assistant", "", [canvasToolCall(codeV2)]),
    ];
    expect(extractLatestCanvasCode(messages)).toBe(codeV2);
  });

  it("skips malformed tool results", () => {
    const validCode = "export default function App() { return <div>OK</div>; }";
    const messages = [
      makeMsg("assistant", "", [canvasToolCall(validCode)]),
      makeMsg("assistant", "", [
        {
          id: "tc2",
          name: "generate_canvas",
          arguments: { description: "broken" },
          result: "not valid json",
        },
      ]),
    ];
    expect(extractLatestCanvasCode(messages)).toBe(validCode);
  });

  it("skips tool calls without result", () => {
    const code = "export default function App() { return <div>OK</div>; }";
    const messages = [
      makeMsg("assistant", "", [canvasToolCall(code)]),
      makeMsg("assistant", "", [
        {
          id: "tc3",
          name: "generate_canvas",
          arguments: { description: "pending" },
        },
      ]),
    ];
    expect(extractLatestCanvasCode(messages)).toBe(code);
  });

  it("ignores non-canvas tool calls", () => {
    const messages = [
      makeMsg("assistant", "", [
        {
          id: "tc4",
          name: "generate_chart",
          arguments: { description: "chart" },
          result: JSON.stringify({ chart_config: {} }),
        },
      ]),
    ];
    expect(extractLatestCanvasCode(messages)).toBeNull();
  });
});
