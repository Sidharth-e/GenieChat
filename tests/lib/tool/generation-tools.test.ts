import { describe, expect, it } from "vitest";

// Importing the tool module reaches `lib/env.ts` eagerly, through the modules it
// pulls in, and that module parses `process.env` at load time and throws when the
// required key is missing. Vitest does not load `.env` into `process.env`, so the
// key is stubbed before the import; nothing under test reads it, and a real value
// already present is kept.
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

describe("createGenerateImageTool", () => {
  it("produces a tool named generate_image", async () => {
    const { createGenerateImageTool } = await import(
      "@/lib/tool/generation-tools"
    );
    expect(createGenerateImageTool("user-1", "chat-1").name).toBe(
      "generate_image",
    );
  });

  it("requires a prompt and accepts an optional ratio and model", async () => {
    const { createGenerateImageTool } = await import(
      "@/lib/tool/generation-tools"
    );
    const tool = createGenerateImageTool("user-1");

    expect(tool.schema.safeParse({ prompt: "a fox" }).success).toBe(true);
    expect(
      tool.schema.safeParse({
        prompt: "a fox",
        aspect_ratio: "16:9",
        model: "black-forest-labs/flux-3-image",
      }).success,
    ).toBe(true);
    expect(tool.schema.safeParse({}).success).toBe(false);
    expect(tool.schema.safeParse({ prompt: "" }).success).toBe(false);
  });

  it("rejects an aspect ratio it does not offer", async () => {
    const { createGenerateImageTool } = await import(
      "@/lib/tool/generation-tools"
    );
    const tool = createGenerateImageTool("user-1");

    expect(
      tool.schema.safeParse({ prompt: "a fox", aspect_ratio: "5:7" }).success,
    ).toBe(false);
  });
});

describe("createGenerateVideoTool", () => {
  it("produces a tool named generate_video", async () => {
    const { createGenerateVideoTool } = await import(
      "@/lib/tool/generation-tools"
    );
    expect(createGenerateVideoTool("user-1", "chat-1").name).toBe(
      "generate_video",
    );
  });

  it("requires a prompt and accepts an optional ratio, length and model", async () => {
    const { createGenerateVideoTool } = await import(
      "@/lib/tool/generation-tools"
    );
    const tool = createGenerateVideoTool("user-1");

    expect(tool.schema.safeParse({ prompt: "a kite in a gale" }).success).toBe(
      true,
    );
    expect(
      tool.schema.safeParse({
        prompt: "a kite in a gale",
        aspect_ratio: "9:16",
        duration_seconds: 8,
        model: "google/veo-3.1",
      }).success,
    ).toBe(true);
    expect(tool.schema.safeParse({}).success).toBe(false);
    expect(tool.schema.safeParse({ prompt: "" }).success).toBe(false);
  });

  it("accepts the ultrawide ratios video offers and images do not", async () => {
    const { createGenerateVideoTool } = await import(
      "@/lib/tool/generation-tools"
    );
    const tool = createGenerateVideoTool("user-1");

    expect(
      tool.schema.safeParse({ prompt: "a kite", aspect_ratio: "21:9" }).success,
    ).toBe(true);
  });

  it("rejects an aspect ratio it does not offer", async () => {
    const { createGenerateVideoTool } = await import(
      "@/lib/tool/generation-tools"
    );
    const tool = createGenerateVideoTool("user-1");

    expect(
      tool.schema.safeParse({ prompt: "a kite", aspect_ratio: "5:7" }).success,
    ).toBe(false);
  });

  it("rejects a clip length that is not a positive whole number of seconds", async () => {
    const { createGenerateVideoTool } = await import(
      "@/lib/tool/generation-tools"
    );
    const tool = createGenerateVideoTool("user-1");

    expect(
      tool.schema.safeParse({ prompt: "a kite", duration_seconds: 0 }).success,
    ).toBe(false);
    expect(
      tool.schema.safeParse({ prompt: "a kite", duration_seconds: 2.5 }).success,
    ).toBe(false);
    expect(
      tool.schema.safeParse({ prompt: "a kite", duration_seconds: 30 }).success,
    ).toBe(true);
  });
});
