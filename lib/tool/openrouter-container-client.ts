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
}

export interface ContainerFileReference {
  fileId: string;
  filename: string;
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

    const files: ContainerFileReference[] = parsedShell.data.files.map((f) => ({
      fileId: f.file_id,
      filename: f.filename,
    }));

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

export async function getContainerFileContent(
  containerId: string,
  fileId: string,
): Promise<string> {
  const response = await openRouterClient.get(
    `/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}/content`,
    {
      responseType: "text",
    },
  );
  return String(response.data);
}
