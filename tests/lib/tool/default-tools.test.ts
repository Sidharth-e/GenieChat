import { describe, expect, it } from "vitest";

// Importing the tool module reaches `lib/env.ts` eagerly, through `@/lib/config`,
// and that module parses `process.env` at load time and throws when the required
// key is missing. Vitest does not load `.env` into `process.env`, so the key is
// stubbed before the import; nothing under test reads it, and a real value
// already present is kept.
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

describe("createKnowledgeBaseSearchTool", () => {
  it("produces a tool named knowledge_base_search", async () => {
    const { createKnowledgeBaseSearchTool } = await import(
      "@/lib/tool/default-tools"
    );
    const tool = createKnowledgeBaseSearchTool("user-1");
    expect(tool.name).toBe("knowledge_base_search");
  });

  it("accepts the query and optional agentId the model passes", async () => {
    const { createKnowledgeBaseSearchTool } = await import(
      "@/lib/tool/default-tools"
    );
    const tool = createKnowledgeBaseSearchTool("user-1");
    expect(tool.schema.safeParse({ query: "pensions" }).success).toBe(true);
    expect(
      tool.schema.safeParse({ query: "pensions", agentId: "agent-1" }).success,
    ).toBe(true);
    expect(tool.schema.safeParse({}).success).toBe(false);
  });
});

describe("resolveDefaultTool", () => {
  it("returns undefined for knowledge_base_search when there is no user id", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("knowledge_base_search")).toBeUndefined();
  });

  it("builds knowledge_base_search when a user id is available", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("knowledge_base_search", "user-1")?.name).toBe(
      "knowledge_base_search",
    );
  });

  it("resolves an ordinary default tool without a user id", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("web_search")?.name).toBe("web_search");
  });

  it("resolves code_sandbox without a user id", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("code_sandbox")?.name).toBe("code_sandbox");
  });

  it("resolves code_sandbox with a user id and chat id", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    const tool = resolveDefaultTool("code_sandbox", "user-1", "chat-1");
    expect(tool?.name).toBe("code_sandbox");
  });

  it("validates code_sandbox schema inputs", async () => {
    const { codeSandbox } = await import("@/lib/tool/default-tools");
    expect(codeSandbox.schema.safeParse({ code: "print(1)" }).success).toBe(true);
    expect(
      codeSandbox.schema.safeParse({
        code: "ls -la",
        language: "bash",
        session_id: "sess_123",
      }).success,
    ).toBe(true);
    expect(codeSandbox.schema.safeParse({}).success).toBe(false);
  });

  it("returns undefined for a name that is not a default tool", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("nope")).toBeUndefined();
  });
});
