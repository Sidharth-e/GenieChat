import "server-only";
import { z } from "zod";

/**
 * Validates environment variables at runtime.
 * This ensures the application fails fast if critical configuration is missing.
 */
const NEXT_BUILD_PHASE = "phase-production-build";

function isMissing(value: string | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function withBuildPlaceholders(
  sourceEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (sourceEnv.NEXT_PHASE !== NEXT_BUILD_PHASE) {
    return sourceEnv;
  }

  const envWithFallbacks: NodeJS.ProcessEnv = { ...sourceEnv };

  const buildPlaceholders: Record<string, string> = {
    MONGODB_URI: "mongodb://build-placeholder:27018",
    NEXTAUTH_SECRET: "build-placeholder-nextauth-secret-123456",
    GITHUB_CLIENT_ID: "build-placeholder-github-client-id",
    GITHUB_CLIENT_SECRET: "build-placeholder-github-client-secret",
    CRON_SECRET: "build-placeholder-cron-secret-123456789",
    SECRET_ENCRYPTION_KEY: "build-placeholder-encryption-key-123456",
    REDIS_URL: "redis://build-placeholder:6379",
    POSTGRES_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    NEO4J_URI: "bolt://placeholder:7687",
    NEO4J_PASSWORD: "placeholder",
  };

  for (const [key, fallback] of Object.entries(buildPlaceholders)) {
    if (isMissing(envWithFallbacks[key])) {
      envWithFallbacks[key] = fallback;
    }
  }

  return envWithFallbacks;
}

const envSchema = z
  .object({
    // MongoDB (Required)
    MONGODB_URI: z.string().min(1),
    MONGODB_DB_NAME: z.string().optional(),

    // Object storage (Optional but recommended) — self-hosted Garage, S3 API.
    //
    // Blank normalises to `undefined` before validation, so `S3_ENDPOINT=`
    // means "not configured" (uploads fail with an ERROR response) rather than
    // a boot error — the same convention REDIS_URL and the other optional
    // vars follow.
    S3_ENDPOINT: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.string().url().optional()),
    // Baked into presigned URLs, which the browser fetches directly. SigV4
    // signs the Host header, so a URL presigned against an internal service
    // name fails in a browser that resolves that name differently. Defaults to
    // S3_ENDPOINT, which is correct when one endpoint serves both.
    S3_PUBLIC_ENDPOINT: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.string().url().optional()),
    // Must equal Garage's `s3_region` (default "garage") or every signature
    // fails validation. Blank normalises to `undefined` so the default applies,
    // rather than becoming `""` and failing every signature at runtime.
    S3_REGION: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.string().default("garage")),
    S3_ACCESS_KEY_ID: z.string().trim().optional(),
    S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
    // `true` is load-bearing, not cosmetic: a virtual-host presigned URL is
    // https://<bucket>.<host>/…, which the browser cannot resolve without
    // wildcard DNS — the same reason S3_PUBLIC_ENDPOINT exists. Path-style
    // keeps every presigned URL on the one hostname that does resolve.
    //
    // Blank normalises to `undefined` first so `.default("true")` applies; a
    // typo still fails loudly at boot rather than silently defaulting.
    S3_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.enum(["true", "false"]).default("true"))
      .transform((value) => value === "true"),

    // Docling (self-hosted document parsing). Optional by design: an
    // unconfigured service degrades to empty extraction, it does not block
    // boot — the same convention the storage vars follow. Blank normalises to
    // `undefined` so `DOCLING_SERVE_URL=` means "not configured" rather than a
    // validation failure.
    DOCLING_SERVE_URL: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.string().url().optional()),
    DOCLING_SERVE_API_KEY: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined)),
    // Blank normalises to `undefined` like the rest, so `DOCLING_SERVE_TIMEOUT_MS=`
    // takes the 360s default rather than failing validation. The conversion is an
    // explicit `Number` rather than `z.coerce.number()` because `.pipe()` requires
    // its target to accept this stage's `string | undefined` output, and a coercing
    // schema takes `unknown`. A non-numeric value becomes NaN, which `z.number()`
    // itself rejects; `.int()` is what rejects a fractional one. Either way a typo
    // fails loudly at boot rather than silently defaulting.
    DOCLING_SERVE_TIMEOUT_MS: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .pipe(z.number().int().positive().optional()),

    // Ollama (chat + embeddings)
    OLLAMA_API_KEY: z.string().optional(),
    OLLAMA_BASE_URL: z.string().url().default("https://ollama.com"),
    OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
    // Only set this for embedding models that accept a custom output width.
    // Must equal the Azure AI Search indexes' vectorSearchDimensions (1536),
    // which means switching models requires recreating those indexes and
    // re-embedding existing content — vectors from different models are not
    // comparable even at the same width.
    OLLAMA_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),

    // External APIs
    GOOGLE_API_KEY: z.string().optional(),
    EXA_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_EMBEDDING_MODEL: z
      .string()
      .default("nvidia/nemotron-3-embed-1b:free"),

    // Auth
    GITHUB_CLIENT_ID: z.string().trim().optional(),
    GITHUB_CLIENT_SECRET: z.string().trim().optional(),
    GITHUB_ADMIN_USERNAMES: z.string().trim().optional(),
    GITHUB_MANAGER_USERNAMES: z.string().trim().optional(),
    GITHUB_VIEWER_USERNAMES: z.string().trim().optional(),
    NEXTAUTH_SECRET: z.string().trim().optional(),

    // Redis
    // A single connection string carries everything the old AZURE_REDIS_* set
    // encoded separately: `rediss://` selects TLS, and credentials in the
    // userinfo become the AUTH password.
    //
    // Blank normalises to `undefined` before URL validation, so `REDIS_URL=`
    // means "not configured" (rate limiting fails open) rather than a boot
    // error — the same convention the other optional vars follow.
    REDIS_URL: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.string().url().optional()),

    // PostgreSQL + pgvector (knowledge RAG). Optional at build time; production
    // requires it via `superRefine` below, on REDIS_URL's precedent — without it
    // knowledge search silently returns nothing.
    //
    // Blank normalises to `undefined` before URL validation, so `POSTGRES_URL=`
    // means "not configured" rather than a boot error, the same convention the
    // other optional vars follow.
    POSTGRES_URL: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined))
      .pipe(z.string().url().optional()),

    // Neo4j graph memory — the sole store for memories. Optional at build time;
    // production requires URI + password via `superRefine` below, because a
    // deployment missing them loses every memory rather than degrading.
    //
    // Blank normalises to `undefined` before URL validation, so `NEO4J_URI=`
    // means "not configured" rather than a boot error, matching the convention
    // the other optional vars follow.
    NEO4J_URI: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : undefined;
      })
      .pipe(z.string().url().optional()),
    NEO4J_USER: z.string().optional(),
    // No default: there is no defensible password, unlike NEO4J_USER where
    // `neo4j` is the image's own. An unset one means "unconfigured".
    NEO4J_PASSWORD: z.string().optional(),
    // Model for the asynchronous entity/relation extraction pass. Defaults to
    // DEFAULT_MODEL_ID in `config.memory.extractionModel`.
    MEMORY_EXTRACTION_MODEL: z.string().optional(),

    // Security
    CRON_SECRET: z.string().optional(),
    SECRET_ENCRYPTION_KEY: z.string().optional(),

    // App
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DEEP_RESEARCH_MODEL: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.NODE_ENV !== "production") {
      return;
    }

    if (!values.NEXTAUTH_SECRET || values.NEXTAUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXTAUTH_SECRET"],
        message:
          "NEXTAUTH_SECRET is required in production and must be at least 32 characters.",
      });
    }

    if (!values.GITHUB_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GITHUB_CLIENT_ID"],
        message: "GITHUB_CLIENT_ID is required in production.",
      });
    }

    if (!values.GITHUB_CLIENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GITHUB_CLIENT_SECRET"],
        message: "GITHUB_CLIENT_SECRET is required in production.",
      });
    }

    if (!values.SECRET_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECRET_ENCRYPTION_KEY"],
        message: "SECRET_ENCRYPTION_KEY is required in production.",
      });
    }

    if (!values.CRON_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message: "CRON_SECRET is required in production.",
      });
    }

    if (!values.MONGODB_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MONGODB_URI"],
        message: "MONGODB_URI is required in production.",
      });
    }

    if (!values.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message:
          "REDIS_URL is required in production. Without it rate limiting fails open.",
      });
    }

    if (!values.POSTGRES_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["POSTGRES_URL"],
        message:
          "POSTGRES_URL is required in production. Without it knowledge search returns nothing.",
      });
    }

    if (!values.NEO4J_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEO4J_URI"],
        message:
          "NEO4J_URI is required in production. Without it every memory is unavailable.",
      });
    }

    if (!values.NEO4J_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEO4J_PASSWORD"],
        message: "NEO4J_PASSWORD is required in production.",
      });
    }
  });

// Parse process.env and export the validated object
export const env = envSchema.parse(withBuildPlaceholders(process.env));
