import { describe, it, expect } from "vitest";
import {
  openaiMessagesToInternal,
  responsesInputToInternal,
  buildChatCompletionResponse,
  buildStreamChunk,
  buildResponsesApiResponse,
} from "@/lib/api/openai-compat";

describe("openaiMessagesToInternal", () => {
  it("extracts a system message into systemPrompt", () => {
    const { systemPrompt, internalMessages } = openaiMessagesToInternal(
      [{ role: "system", content: "You are helpful." }],
      "user1",
    );
    expect(systemPrompt).toBe("You are helpful.");
    expect(internalMessages).toHaveLength(0);
  });

  it("converts user and assistant messages to internalMessages", () => {
    const { systemPrompt, internalMessages } = openaiMessagesToInternal(
      [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
      "user1",
    );
    expect(systemPrompt).toBe("");
    expect(internalMessages).toHaveLength(2);
    expect(internalMessages[0].role).toBe("user");
    expect(internalMessages[0].content).toBe("Hello");
    expect(internalMessages[1].role).toBe("assistant");
    expect(internalMessages[1].content).toBe("Hi there");
  });

  it("concatenates multiple system messages with a newline", () => {
    const { systemPrompt } = openaiMessagesToInternal(
      [
        { role: "system", content: "Part 1." },
        { role: "system", content: "Part 2." },
      ],
      "user1",
    );
    expect(systemPrompt).toBe("Part 1.\nPart 2.");
  });

  it("returns empty results for an empty messages array", () => {
    const { systemPrompt, internalMessages } = openaiMessagesToInternal([], "user1");
    expect(systemPrompt).toBe("");
    expect(internalMessages).toHaveLength(0);
  });

  it("stamps each internal message with the provided userId", () => {
    const { internalMessages } = openaiMessagesToInternal(
      [{ role: "user", content: "hi" }],
      "user-xyz",
    );
    expect(internalMessages[0].userId).toBe("user-xyz");
  });
});

describe("responsesInputToInternal", () => {
  it("wraps a plain string as a single user message", () => {
    const { systemPrompt, internalMessages } = responsesInputToInternal("Hello", "u1");
    expect(systemPrompt).toBe("");
    expect(internalMessages).toHaveLength(1);
    expect(internalMessages[0].role).toBe("user");
    expect(internalMessages[0].content).toBe("Hello");
  });

  it("delegates an array of messages to openaiMessagesToInternal", () => {
    const { internalMessages } = responsesInputToInternal(
      [{ role: "user", content: "Hi" }],
      "u1",
    );
    expect(internalMessages).toHaveLength(1);
    expect(internalMessages[0].content).toBe("Hi");
  });

  it("handles system messages in array input", () => {
    const { systemPrompt, internalMessages } = responsesInputToInternal(
      [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hello" },
      ],
      "u1",
    );
    expect(systemPrompt).toBe("Be terse.");
    expect(internalMessages).toHaveLength(1);
  });
});

describe("buildChatCompletionResponse", () => {
  it("returns a response with the correct shape", () => {
    const res = buildChatCompletionResponse("Hello!", "gpt-5.4", "resp-001");
    expect(res.object).toBe("chat.completion");
    expect(res.id).toBe("resp-001");
    expect(res.model).toBe("gpt-5.4");
  });

  it("contains a single choice with role assistant and finish_reason stop", () => {
    const res = buildChatCompletionResponse("Hello!", "gpt-5.4", "resp-001");
    expect(res.choices).toHaveLength(1);
    expect(res.choices[0].message.role).toBe("assistant");
    expect(res.choices[0].message.content).toBe("Hello!");
    expect(res.choices[0].finish_reason).toBe("stop");
    expect(res.choices[0].index).toBe(0);
  });

  it("sets created to a unix timestamp (seconds)", () => {
    const before = Math.floor(Date.now() / 1000);
    const res = buildChatCompletionResponse("x", "m", "id");
    const after = Math.floor(Date.now() / 1000);
    expect(res.created).toBeGreaterThanOrEqual(before);
    expect(res.created).toBeLessThanOrEqual(after);
  });
});

describe("buildStreamChunk", () => {
  it("returns a data: SSE line ending with double newline", () => {
    const line = buildStreamChunk("token", "gpt-5.4", "resp-001");
    expect(line).toMatch(/^data: /);
    expect(line).toMatch(/\n\n$/);
  });

  it("puts content in delta.content when finishReason is null", () => {
    const line = buildStreamChunk("token", "gpt-5.4", "resp-001", null);
    const chunk = JSON.parse(line.replace(/^data: /, "").trim());
    expect(chunk.choices[0].delta.content).toBe("token");
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it("emits an empty delta when finishReason is stop", () => {
    const line = buildStreamChunk("", "gpt-5.4", "resp-001", "stop");
    const chunk = JSON.parse(line.replace(/^data: /, "").trim());
    expect(chunk.choices[0].delta).toEqual({});
    expect(chunk.choices[0].finish_reason).toBe("stop");
  });

  it("sets id and model in the chunk", () => {
    const line = buildStreamChunk("t", "gpt-5.4", "resp-xyz");
    const chunk = JSON.parse(line.replace(/^data: /, "").trim());
    expect(chunk.id).toBe("resp-xyz");
    expect(chunk.model).toBe("gpt-5.4");
    expect(chunk.object).toBe("chat.completion.chunk");
  });
});

describe("buildResponsesApiResponse", () => {
  it("returns a response with the correct shape", () => {
    const res = buildResponsesApiResponse("Answer", "gpt-5.4", "resp-001");
    expect(res.object).toBe("response");
    expect(res.id).toBe("resp-001");
    expect(res.model).toBe("gpt-5.4");
  });

  it("embeds the content text in output[0]", () => {
    const res = buildResponsesApiResponse("Answer text", "gpt-5.4", "resp-001");
    expect(res.output).toHaveLength(1);
    expect(res.output[0].type).toBe("message");
    expect(res.output[0].role).toBe("assistant");
    expect(res.output[0].content).toHaveLength(1);
    expect(res.output[0].content[0].type).toBe("output_text");
    expect(res.output[0].content[0].text).toBe("Answer text");
  });
});
