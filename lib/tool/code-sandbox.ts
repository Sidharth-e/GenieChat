import "server-only";
import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

const OPENROUTER_TIMEOUT_MS = 180_000;
const RUNNER_MODEL = "openai/gpt-4o-mini";

const openRouterClient: AxiosInstance = axios.create({
  baseURL: "https://openrouter.ai/api/v1",
  timeout: OPENROUTER_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

openRouterClient.interceptors.request.use((reqConfig) => {
  const apiKey = config.openrouter.apiKey;
  if (apiKey) {
    reqConfig.headers.Authorization = `Bearer ${apiKey}`;
  }
  return reqConfig;
});

openRouterClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      "OpenRouter request failed";
    return Promise.reject(new Error(message));
  },
);

const commandOutputSchema = z.object({
  stdout: z.string().optional().default(""),
  stderr: z.string().optional().default(""),
  outcome: z
    .object({
      type: z.string().optional(),
      exit_code: z.number().optional(),
    })
    .optional(),
});

const fileCitationSchema = z.object({
  type: z.string().optional(),
  container_id: z.string().optional(),
  file_id: z.string(),
  filename: z.string(),
});

const shellToolOutputSchema = z.object({
  type: z.literal("openrouter:shell"),
  output: z.array(commandOutputSchema).optional().default([]),
  container_id: z.string().optional(),
  files: z.array(fileCitationSchema).optional().default([]),
});

const openRouterResponseSchema = z.object({
  id: z.string().optional(),
  output: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});

const containerFileSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  container_id: z.string().optional(),
  bytes: z.number().optional(),
  created_at: z.number().optional(),
  path: z.string(),
  source: z.string().optional(),
});

const containerFilesListSchema = z.object({
  data: z.array(containerFileSchema).optional().default([]),
  has_more: z.boolean().optional().default(false),
});

export interface ExecuteContainerOptions {
  code: string;
  language?: "python" | "bash";
  containerId?: string;
  sessionId?: string;
  timeoutMs?: number;
  userId?: string;
  chatId?: string;
}

export interface ContainerFileReference {
  fileId: string;
  filename: string;
  url?: string;
  downloadUrl?: string;
  download_url?: string;
  artifactId?: string;
}

export interface ContainerExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  containerId?: string;
  files?: ContainerFileReference[];
  error?: string;
}

export interface ContainerFileInfo {
  id: string;
  path: string;
  bytes?: number;
  createdAt?: number;
}

export async function executeInContainer(
  options: ExecuteContainerOptions,
): Promise<ContainerExecutionResult> {
  const apiKey = config.openrouter.apiKey;
  if (!apiKey) {
    return {
      stdout: "",
      stderr: "OPENROUTER_API_KEY is not configured",
      exitCode: 1,
      error: "OPENROUTER_API_KEY is not configured",
    };
  }

  const language = options.language ?? "python";
  const prompt =
    language === "bash"
      ? `Execute the following bash commands inside the sandbox environment:\n\`\`\`bash\n${options.code}\n\`\`\``
      : `Execute the following Python code inside the sandbox environment:\n\`\`\`python\n${options.code}\n\`\`\``;

  const environmentConfig = options.containerId
    ? {
        type: "container_reference" as const,
        container_id: options.containerId,
      }
    : {
        type: "container_auto" as const,
      };

  const payload: Record<string, unknown> = {
    model: RUNNER_MODEL,
    input: prompt,
    tools: [
      {
        type: "openrouter:shell",
        parameters: {
          engine: "openrouter",
          environment: environmentConfig,
        },
      },
    ],
  };

  if (options.sessionId) {
    payload.session_id = options.sessionId.slice(-20);
  }

  try {
    const response = await openRouterClient.post("/responses", payload);
    const parsedResponse = openRouterResponseSchema.safeParse(response.data);

    if (!parsedResponse.success) {
      return {
        stdout: "",
        stderr: "Failed to parse OpenRouter response",
        exitCode: 1,
        error: parsedResponse.error.message,
      };
    }

    const rawShellCall = parsedResponse.data.output.find(
      (item) => item.type === "openrouter:shell",
    );

    if (!rawShellCall) {
      return {
        stdout: "",
        stderr: "No shell tool call was executed by the runner model",
        exitCode: 1,
      };
    }

    const parsedShell = shellToolOutputSchema.safeParse(rawShellCall);
    if (!parsedShell.success) {
      return {
        stdout: "",
        stderr: "Malformed shell output structure",
        exitCode: 1,
        error: parsedShell.error.message,
      };
    }

    const commandOutputs = parsedShell.data.output;
    const stdout = commandOutputs.map((item) => item.stdout).join("\n").trim();
    const stderr = commandOutputs.map((item) => item.stderr).join("\n").trim();
    const exitCode = commandOutputs.reduce((code, item) => {
      if (item.outcome?.exit_code !== undefined) {
        return item.outcome.exit_code;
      }
      return code;
    }, 0);

    const files: ContainerFileReference[] = [];

    for (const f of parsedShell.data.files) {
      const cid =
        f.container_id || parsedShell.data.container_id || options.containerId;
      let fileUrl: string | undefined;
      let artifactId: string | undefined;

      if (cid && f.file_id) {
        const saved = await saveContainerFileArtifact(
          cid,
          f.file_id,
          f.filename,
          options,
        );
        fileUrl = saved.fileUrl;
        artifactId = saved.artifactId;
      }

      files.push({
        fileId: f.file_id,
        filename: f.filename,
        url: fileUrl,
        downloadUrl: fileUrl,
        download_url: fileUrl,
        artifactId,
      });
    }

    return {
      stdout,
      stderr,
      exitCode,
      containerId: parsedShell.data.container_id,
      files: files.length > 0 ? files : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "OpenRouter container execution failed");
    return {
      stdout: "",
      stderr: message,
      exitCode: 1,
      error: message,
    };
  }
}

async function saveContainerFileArtifact(
  containerId: string,
  fileId: string,
  filename: string,
  options: ExecuteContainerOptions,
): Promise<{ fileUrl?: string; artifactId?: string }> {
  try {
    const { putObject, presignGet } = await import("@/lib/storage");
    const { keyForUser } = await import("@/lib/storage/ref");
    const { STORAGE_BUCKETS, STORAGE_TTL } = await import(
      "@/constants/storage"
    );
    const { ArtifactStore } = await import("@/lib/mongodb/artifact-store");
    const { isDatabaseConfigured } = await import("@/lib/mongodb/client");
    const { generateId } = await import("@/lib/utils");

    const buffer = await getContainerFileBuffer(containerId, fileId);
    const mime = getMimeType(filename);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const effectiveUserId =
      options.userId || options.sessionId || "anonymous";
    const s3Key = keyForUser(
      effectiveUserId,
      "code_sandbox",
      `${generateId()}-${sanitizedFilename}`,
    );

    let storageRef: string | undefined;
    let fileUrl = "";
    const uploaded = await putObject(
      STORAGE_BUCKETS.artifacts,
      s3Key,
      buffer,
    );

    if (uploaded.status === "OK") {
      storageRef = uploaded.response;
      try {
        fileUrl = await presignGet(storageRef, STORAGE_TTL.attachment);
      } catch (signErr) {
        logger.warn(
          { err: signErr, storageRef },
          "Failed to presign storage URL for container file",
        );
        fileUrl = storageRef;
      }
    }

    let artifactId: string | undefined;
    if (isDatabaseConfigured()) {
      try {
        const artifactStore = new ArtifactStore();
        const created = await artifactStore.createArtifact(effectiveUserId, {
          type: "code_sandbox",
          title: filename,
          url: storageRef || fileUrl || "",
          chatId: options.chatId || options.sessionId,
          metadata: {
            containerId,
            fileId,
            filename,
            size: buffer.length,
          },
        });
        artifactId = created.id;
        if (!fileUrl && created.url) {
          fileUrl = created.url;
        }
      } catch (dbErr) {
        logger.error(
          { err: dbErr, filename },
          "Failed to save container file artifact to database",
        );
      }
    }

    if (!fileUrl && buffer.length > 0) {
      fileUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    }

    return { fileUrl: fileUrl || undefined, artifactId };
  } catch (err) {
    logger.error(
      { err, fileId, filename },
      "Failed to process container file artifact",
    );
    return {};
  }
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    case "html":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

export async function listContainerFiles(
  containerId: string,
): Promise<ContainerFileInfo[]> {
  try {
    const response = await openRouterClient.get(
      `/containers/${encodeURIComponent(containerId)}/files`,
    );
    const parsed = containerFilesListSchema.safeParse(response.data);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.data.map((file) => ({
      id: file.id,
      path: file.path,
      bytes: file.bytes,
      createdAt: file.created_at,
    }));
  } catch (error) {
    logger.error({ err: error, containerId }, "Failed to list container files");
    return [];
  }
}

export async function getContainerFileBuffer(
  containerId: string,
  fileId: string,
): Promise<Buffer> {
  const response = await openRouterClient.get<ArrayBuffer>(
    `/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}/content`,
    {
      responseType: "arraybuffer",
    },
  );
  return Buffer.from(response.data);
}

export async function getContainerFileContent(
  containerId: string,
  fileId: string,
): Promise<string> {
  const buffer = await getContainerFileBuffer(containerId, fileId);
  return buffer.toString("utf-8");
}
