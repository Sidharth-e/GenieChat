import "server-only";
/**
 * Centralized configuration for all Azure services and application settings.
 * All environment variables and configuration constants are defined here
 * for type safety and easier maintenance.
 */

import { defaultSystemPrompt, threadTitlePrompt } from "@/constants/prompt";
import { env } from "./env";

export const config = {
  mongodb: {
    uri: env.MONGODB_URI,
    databaseName: env.MONGODB_DB_NAME || "geniechat",
    collections: {
      history: "history",
      threads: "threads",
      agents: "agents",
      prompts: "prompt",
      mcpServers: "mcp_server",
      config: "config",
      logs: "logs",
      workflows: "workflows",
      workflowExecutions: "workflow_executions",
      tools: "tools",
      documents: "documents",
      deepResearch: "deep_research",
      memories: "memories",
      notes: "notes",
      users: "users",
      autoTasks: "auto_tasks",
      artifacts: "artifacts",
      webhooks: "webhooks",
    },
  },

  storage: {
    endpoint: env.S3_ENDPOINT,
    // Falls back to the internal endpoint, which is right whenever one address
    // serves both the app and the browser.
    publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  },

  azureSearch: {
    name: env.AZURE_SEARCH_NAME,
    apiKey: env.AZURE_SEARCH_API_KEY,
    agentDocumentsIndexName: "agent-documents-index",
    memoryIndexName: "memory-index",
  },

  docling: {
    baseUrl: env.DOCLING_SERVE_URL,
    apiKey: env.DOCLING_SERVE_API_KEY,
    // Deliberately above the `document_timeout` the APP sends per request
    // (DOCLING_DOCUMENT_TIMEOUT_S, 300s), so the service ends the conversion and
    // returns a body the client can map and log, rather than this aborting first
    // with an opaque AbortError. The body is not an error status: a timeout
    // returns `partial_success` with no content, and reaches the error arm only
    // via the empty-content guard (see constants/docling.ts). Still below
    // DOCLING_SERVE_MAX_SYNC_WAIT (600s).
    //
    // Note `document_timeout` is a request option, not a service setting: the
    // service's own ceiling is `max_document_timeout`, which defaults to seven
    // days. There is no 300 to find in the service config, so do not go looking
    // — the 300 is this app's choice, made in constants/docling.ts.
    timeoutMs: env.DOCLING_SERVE_TIMEOUT_MS ?? 360_000,
  },

  google: {
    apiKey: env.GOOGLE_API_KEY,
  },

  ollama: {
    baseUrl: env.OLLAMA_BASE_URL,
    apiKey: env.OLLAMA_API_KEY,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
    embeddingDimensions: env.OLLAMA_EMBEDDING_DIMENSIONS,
  },

  exa: {
    apiKey: env.EXA_API_KEY,
    baseUrl: "https://api.exa.ai",
  },
  auth: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      adminUsernames:
        env.GITHUB_ADMIN_USERNAMES?.split(",")
          .map((login) => login.trim())
          .filter(Boolean) ?? [],
      managerUsernames:
        env.GITHUB_MANAGER_USERNAMES?.split(",")
          .map((login) => login.trim())
          .filter(Boolean) ?? [],
      viewerUsernames:
        env.GITHUB_VIEWER_USERNAMES?.split(",")
          .map((login) => login.trim())
          .filter(Boolean) ?? [],
    },
    nextAuthSecret: env.NEXTAUTH_SECRET,
  },

  rateLimit: {
    standard: { limit: 30, windowMs: 60_000 },
    medium: { limit: 20, windowMs: 60_000 },
    strict: { limit: 10, windowMs: 60_000 },
    streaming: { limit: 50, windowMs: 60_000 },
    upload: { limit: 15, windowMs: 60_000 },
    download: { limit: 60, windowMs: 60_000 },
    photo: { limit: 120, windowMs: 60_000 },
    research: { limit: 20, windowMs: 600_000 },
    researchExecute: { limit: 5, windowMs: 600_000 },
  },

  redis: {
    url: env.REDIS_URL,
  },

  app: {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
  },
  defaultToolConfig: {
    mermaid: {
      model: "gemini-3-flash-preview",
      temperature: 0.1,
    },
    chart: {
      model: "gemini-3-flash-preview",
      temperature: 0.1,
    },
  },
  chat: {
    defaultChatSystemPrompt: defaultSystemPrompt,
    threadTitlePrompt: threadTitlePrompt,
    titleGenerationModel: "gemma4",
    titleGenerationTemperature: 0.7,
    defaultChatTemperature: 0.8,
  },
  deepResearch: {
    model: env.DEEP_RESEARCH_MODEL || "gemini-3-flash-preview",
  },
} as const;

export function isDatabaseConfigured(): boolean {
  return !!env.MONGODB_URI;
}

export type Config = typeof config;
