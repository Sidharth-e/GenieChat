import { describe, expect, it, vi } from "vitest";

process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

describe("openrouter-container-client", () => {
  it("returns error when OPENROUTER_API_KEY is not configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/config", () => ({
      config: {
        openrouter: {
          apiKey: undefined,
        },
      },
    }));

    const { executeInContainer } = await import(
      "@/lib/tool/openrouter-container-client"
    );
    const result = await executeInContainer({ code: "print(1)" });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("OPENROUTER_API_KEY");

    vi.doUnmock("@/lib/config");
  });

  it("handles empty container files gracefully", async () => {
    const { listContainerFiles } = await import(
      "@/lib/tool/openrouter-container-client"
    );
    const files = await listContainerFiles("invalid_container_id_12345");
    expect(Array.isArray(files)).toBe(true);
  });
});
