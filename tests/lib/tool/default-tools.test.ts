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

  it("builds code_sandbox for a thread so the sandbox session can be the thread", async () => {
    const { resolveDefaultTool, createCodeSandboxTool } = await import(
      "@/lib/tool/default-tools"
    );
    const threadId = "0192f3a4-7b21-7c3d-9e4f-5a6b7c8d9e0f";
    expect(resolveDefaultTool("code_sandbox", "user-1", threadId)?.name).toBe(
      "code_sandbox",
    );
    expect(createCodeSandboxTool("user-1", threadId).name).toBe("code_sandbox");
  });

  it("resolves every name it advertises as resolvable", async () => {
    const { resolveDefaultTool, RESOLVABLE_DEFAULT_TOOLS } = await import(
      "@/lib/tool/default-tools"
    );
    for (const name of RESOLVABLE_DEFAULT_TOOLS) {
      expect(resolveDefaultTool(name, "user-1"), name).toBeDefined();
    }
  });
});

// The generation tools live in `generation-tools.ts` and are tested there; what
// belongs here is that the resolver routes their names to them.
describe("generation tool resolution", () => {
  it("returns undefined without a user id, since the result needs an owner", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("generate_image")).toBeUndefined();
    expect(resolveDefaultTool("generate_video")).toBeUndefined();
  });

  it("builds each of them when a user id is available", async () => {
    const { resolveDefaultTool } = await import("@/lib/tool/default-tools");
    expect(resolveDefaultTool("generate_image", "user-1")?.name).toBe(
      "generate_image",
    );
    expect(resolveDefaultTool("generate_video", "user-1", "chat-1")?.name).toBe(
      "generate_video",
    );
  });
});

describe("sandboxSessionId", () => {
  it("scopes the container to the thread, not to the session id the model asked for", async () => {
    const { sandboxSessionId } = await import("@/lib/tool/default-tools");
    const threadId = "0192f3a4-7b21-7c3d-9e4f-5a6b7c8d9e0f";
    expect(sandboxSessionId(threadId, "invented-by-the-model")).toBe(threadId);
  });

  it("falls back to the model's session id where there is no thread to scope to", async () => {
    const { sandboxSessionId } = await import("@/lib/tool/default-tools");
    expect(sandboxSessionId(undefined, "sess-1")).toBe("sess-1");
  });

  it("names no session when neither the thread nor the model supplied one", async () => {
    const { sandboxSessionId } = await import("@/lib/tool/default-tools");
    expect(sandboxSessionId(undefined, undefined)).toBeUndefined();
  });

  it("treats a blank thread as no thread, keeping the model's session id usable", async () => {
    const { sandboxSessionId } = await import("@/lib/tool/default-tools");
    expect(sandboxSessionId("", "sess-1")).toBe("sess-1");
  });
});
