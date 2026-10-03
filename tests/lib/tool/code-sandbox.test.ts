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

  it("stores generated files in artifacts and returns blob url", async () => {
    vi.resetModules();

    vi.doMock("@/lib/config", () => ({
      config: {
        openrouter: {
          apiKey: "test-api-key",
        },
      },
    }));

    const mockPutObject = vi.fn().mockImplementation((bucket, key) =>
      Promise.resolve({
        status: "OK",
        response: `s3://${bucket}/${key}`,
      }),
    );

    vi.doMock("@/lib/storage", () => ({
      putObject: mockPutObject,
      presignGet: vi
        .fn()
        .mockImplementation((ref) =>
          Promise.resolve(
            `https://garage.example.com/${ref.replace("s3://", "")}?signed=1`,
          ),
        ),
    }));

    vi.doMock("@/lib/mongodb/client", () => ({
      isDatabaseConfigured: vi.fn().mockReturnValue(true),
    }));

    const mockCreateArtifact = vi.fn().mockResolvedValue({
      id: "art-123",
      url: "https://garage.example.com/signed=1",
    });

    vi.doMock("@/lib/mongodb/artifact-store", () => ({
      ArtifactStore: class {
        createArtifact = mockCreateArtifact;
      },
    }));

    vi.doMock("axios", () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: {
          id: "resp-1",
          output: [
            {
              type: "openrouter:shell",
              output: [{ stdout: "files created", stderr: "", outcome: { exit_code: 0 } }],
              container_id: "container-xyz",
              files: [
                {
                  file_id: "file-image-1",
                  filename: "plot.png",
                },
                {
                  file_id: "file-doc-2",
                  filename: "report.txt",
                },
              ],
            },
          ],
        },
      });

      const mockGet = vi.fn().mockResolvedValue({
        data: Buffer.from("fake-file-bytes"),
      });

      return {
        default: {
          create: vi.fn().mockReturnValue({
            interceptors: {
              request: { use: vi.fn() },
              response: { use: vi.fn() },
            },
            post: mockPost,
            get: mockGet,
          }),
        },
      };
    });

    const { executeInContainer } = await import(
      "@/lib/tool/openrouter-container-client"
    );

    const result = await executeInContainer({
      code: "generate_files()",
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.exitCode).toBe(0);
    expect(result.files).toBeDefined();
    expect(result.files).toHaveLength(2);

    expect(result.files![0].filename).toBe("plot.png");
    expect(result.files![0].url).toContain("artifacts");
    expect(mockPutObject).toHaveBeenCalledWith(
      "artifacts",
      expect.stringContaining("plot.png"),
      expect.any(Buffer),
    );

    expect(result.files![1].filename).toBe("report.txt");
    expect(result.files![1].url).toContain("artifacts");
    expect(mockPutObject).toHaveBeenCalledWith(
      "artifacts",
      expect.stringContaining("report.txt"),
      expect.any(Buffer),
    );

    vi.doUnmock("@/lib/config");
    vi.doUnmock("@/lib/storage");
    vi.doUnmock("@/lib/mongodb/client");
    vi.doUnmock("@/lib/mongodb/artifact-store");
    vi.doUnmock("axios");
  });
});
