import "server-only";
/**
 * Centralized configuration for all external services and application settings.
 * All environment variables and configuration constants are defined here
 * for type safety and easier maintenance.
 */

import { defaultSystemPrompt, threadTitlePrompt } from "@/constants/prompt";
import { DEFAULT_MODEL_ID } from "./langchain/model-config";
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
      connectors: "connectors",
      config: "config",
      logs: "logs",
      workflows: "workflows",
      workflowExecutions: "workflow_executions",
      tools: "tools",
      documents: "documents",
      deepResearch: "deep_research",
      notes: "notes",
      users: "users",
      autoTasks: "auto_tasks",
      artifacts: "artifacts",
      webhooks: "webhooks",
      schedules: "schedules",
      scheduleRuns: "schedule_runs",
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

  // Knowledge RAG storage. `url` is undefined when POSTGRES_URL is unset, and
  // the readers throw rather than degrading: a knowledge store that answers
  // nothing while claiming to work is harder to diagnose than one that says it
  // is unconfigured, and boot is not what would be blocked either way.
  postgres: {
    url: env.POSTGRES_URL,
    poolMax: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },

  neo4j: {
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER ?? "neo4j",
    password: env.NEO4J_PASSWORD,
    // Bounded retry, so an unreachable server produces an error rather than a
    // retry storm inside a chat turn.
    maxTransactionRetryTime: 15_000,
    connectionTimeoutMs: 5_000,
  },

  memory: {
    // Mirrors deepResearch.model's precedent.
    extractionModel: env.MEMORY_EXTRACTION_MODEL ? env.MEMORY_EXTRACTION_MODEL : "gemma4",
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

  openrouter: {
    apiKey: env.OPENROUTER_API_KEY,
    embeddingModel: env.OPENROUTER_EMBEDDING_MODEL,
    // One embedding request is a small, fast call — it is the loop of them over
    // a document's chunks that takes the time, not any single one.
    embeddingTimeoutMs: 60_000,
    // The model the code-sandbox tool drives, and how long one shell call may
    // take. Deliberately not in `AVAILABLE_MODELS`: it is never user-selectable,
    // only the engine behind that one tool's calls.
    sandboxModel: "openai/gpt-4o-mini",
    sandboxTimeoutMs: 180_000,
  },

  ollama: {
    baseUrl: env.OLLAMA_BASE_URL,
    apiKey: env.OLLAMA_API_KEY,
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
  chat: {
    defaultChatSystemPrompt: defaultSystemPrompt,
    threadTitlePrompt: threadTitlePrompt,
    titleGenerationModel: "gemma4",
    titleGenerationTemperature: 0.7,
    defaultChatTemperature: 0.8,
  },
  deepResearch: {
    // Falls back to the app-wide default rather than repeating the id, so the
    // fallback cannot be a model `AVAILABLE_MODELS` no longer carries.
    model: env.DEEP_RESEARCH_MODEL || DEFAULT_MODEL_ID,
  },

  generation: {
    // One curated default each rather than a picker: the OpenRouter catalogue is
    // large and its slugs churn, and its models differ mainly in capability —
    // reference images, output format, resolution tiers — not in taste, which is
    // what a user-facing selector would be for. Each tool still takes a `model`
    // argument, so the model can override when the request names one.
    defaultImageModel: "google/gemini-3.1-flash-image",
    defaultVideoModel: "google/veo-3.1",

    // Deliberately short, and separate lists because the endpoints accept
    // different sets — video admits `3:2`, `2:3` and the two ultrawides that
    // images do not. Providers clamp a requested ratio to their own subset rather
    // than rejecting it, so a longer list would advertise ratios some models
    // cannot honour, and the model reads this list as its options.
    imageAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    videoAspectRatios: [
      "16:9",
      "9:16",
      "1:1",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "9:21",
    ],

    // Image generation outruns a chat completion — a large prompt on a capable
    // model is tens of seconds, and the provider fans out to a backend — so this
    // sits well above the embedding client's 60s.
    imageTimeoutMs: 180_000,

    // The video job's three clocks, which are not interchangeable. Video
    // generation is asynchronous, so one timeout cannot express it: a *poll* is a
    // fast request, the *interval* between polls has to be long enough not to
    // hammer the provider, and the *wait* is how long the whole job is worth
    // holding a tool call open for. Collapsing them into one number would either
    // give each poll a five-minute budget or abandon a job still in flight.
    videoTimeoutMs: 60_000,
    videoPollIntervalMs: 15_000,
    videoMaxWaitMs: 300_000,
  },
} as const;

export function isDatabaseConfigured(): boolean {
  return !!env.MONGODB_URI;
}

export type Config = typeof config;
