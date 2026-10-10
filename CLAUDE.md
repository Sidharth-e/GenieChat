# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Maintenance

Keep this file current. After any significant change — new features, architecture shifts, new dependencies, convention changes, env var additions, deployment changes — update the relevant section. Stale docs are worse than no docs.

## Project Overview

**GenieChat** — an enterprise AI chat interface built with Next.js 16 (App Router). It supports multi-model conversations across two providers — Ollama (Ollama Cloud by default, or a self-hosted daemon) and Google Gemini — plus multi-agent orchestration, tool execution, workflow automation, and workspace features (notes). Authentication is GitHub via NextAuth.js. Data is stored in MongoDB, accessed through the official `mongodb` driver, and the memory graph in Neo4j. Object storage is self-hosted Garage behind the S3 API, referenced by canonical `s3://bucket/key` refs and signed on read, so no durable URL is ever stored.

Chat completions and text embeddings both come from Ollama. Embeddings feed two stores — agent- and chat-document knowledge RAG in PostgreSQL + pgvector, and the memory graph in Neo4j — and both index at `EMBEDDING_DIMENSIONS` (`constants/embeddings.ts`), which must match the configured embedding model's output width.

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm dev:secure       # Dev server with NODE_TLS_REJECT_UNAUTHORIZED=0
pnpm build            # Production build (Next.js standalone output)
pnpm lint             # ESLint (next/core-web-vitals + typescript)
pnpm type-check       # TypeScript type checking (tsc --noEmit)
pnpm test             # Runs Vitest unit tests
pnpm test:watch       # Runs Vitest in watch mode
pnpm test:coverage    # Runs Vitest with coverage
pnpm ci:check         # Runs type-check + lint + test
pnpm db:setup         # Creates all 19 collections and their indexes; idempotent and safe to re-run
pnpm db:setup:pg      # Creates the pgvector table and indexes; idempotent and safe to re-run
pnpm db:setup:neo4j   # Creates the Neo4j constraints and memory vector indexes; idempotent
pnpm embeddings:check # Exercises the Ollama embedding path: short, over-budget and empty input
pnpm knowledge:check  # Exercises the knowledge store: lexical, vector, fusion, replace semantics
pnpm knowledge:backfill # Re-chunks and re-embeds documents already in MongoDB
pnpm memory:check     # Exercises the fact graph: writes, recall, orphan GC, paging, statement syntax
pnpm memory:eval      # Scores recall against the fixed probe set; the only way to tune the read path
pnpm memory:sweep    # Runs one sweep pass against the running app's CRON_SECRET endpoint
pnpm memory:drop-prose # One-off: drops every `:Memory` node and the index and constraint that served them
pnpm schedules:check  # Exercises the scheduling concurrency properties: claim race, lease reaper, retry exhaustion, overlap
pnpm schedules:migrate # One-off: converts legacy workflow cron triggers into `schedules`
pnpm storage:check    # Exercises the Garage S3 client: put, presign, fetch, delete, NOT_FOUND
```

Package manager is **pnpm** (v11.1.2, `node-linker=hoisted`). Node >= 20 required.

`tsx` is the standalone Node runner for scripts that must run outside the Next.js build and the Vitest test environment — `scripts/setup-mongodb.ts` is such a script: a dev/ops bootstrap rather than application code.

## Architecture

### Route Groups (App Router)

- `app/(main)/` — authenticated pages: chat, agent-chat, multi-agent-chat, swarm-chat, auto, agents, tools, connectors, webhooks, artifacts, memories, workflow, workspace, admin, settings
- `app/(forms)/` — form-based CRUD pages: agents, tools, connectors, webhooks, workflow (separate layout, no chat sidebar)
- `app/api/` — API routes for chat streaming, agents, workflows, arena, secrets, storage, etc.
- `app/login/` — login page
- `app/preview/` — standalone views

Prompts are the exception to the page-per-entity rule: they have no route of their own. The chat input's `PromptLibraryModal` (`components/chat/prompt-library-modal.tsx`) is the only surface, and it has two modes. The library — header, tabs, card grid, and a right pane previewing the selected prompt — and, when you press New Prompt or Edit, the editor (`components/prompts/prompt-editor.tsx`), which takes over the whole modal: the library blocks are guarded by `!editorState` rather than nested in a branch, so the editor is a sibling and the list keeps its indentation and its state. The editor's own header carries back (to the list) and close (the library), the AI Assist button (the shared `PromptDialog`, parameterised for prompt copy rather than agent instructions), and Cancel/Save in the footer. One modal, so there is no second page, no nested overlay, and no second header to keep in sync.

### Server-Side Core (`lib/`)

- `lib/env.ts` — Zod-validated environment variables. Fails fast if required vars missing. Uses build placeholders during `next build`.
- `lib/config.ts` — Centralized config object consuming `env.ts`. Model defaults and feature settings live here.
- `lib/storage/` — object storage on Garage's S3 API. `ref.ts` parses and formats `s3://bucket/key` refs and is pure and unit-tested; `s3-core.ts` holds the operations; `s3-client.ts` is the `"server-only"` layer that binds `config.storage` to them; `index.ts` re-exports the public surface. `ref.ts` and `s3-core.ts` deliberately import neither `@/lib/config` nor `@/lib/env` — only `s3-client.ts` may, which keeps the reference format and the operations testable without environment configuration. `constants/storage.ts` holds the bucket names and the presigned-URL TTLs.
- `lib/docling/` — document parsing on the self-hosted `docling-serve` sidecar. `response.ts` maps a conversion response to `ConvertedDocument` and is pure and unit-tested; `client.ts` is the `"server-only"` layer that performs the HTTP call; `index.ts` re-exports the public surface. `constants/docling.ts` holds the per-request `document_timeout` and the TableFormer mode. See [Document Parsing (Docling)](#document-parsing-docling).
- `lib/postgres/` — PostgreSQL + pgvector, the knowledge-RAG store. `config.ts` reads `config.postgres` and is pure; `client.ts` is the `"server-only"` layer holding one lazily-built `Pool`; `vector.ts` holds `toVectorLiteral()` and is pure and unit-tested. `lib/knowledge/` sits on top: `chunking.ts`, `ranking.ts` and `embed.ts` are pure and unit-tested, `index.ts` is the writer, `search.ts` the hybrid retriever, `documents.ts` and `citation-services.ts` the document and citation ports. `embed.ts` holds the embed-before-transaction loop and the policy that separates a width mismatch (rethrow — the index is broken) from an outage (store the chunk vectorless). See [Knowledge RAG (Postgres + pgvector)](#knowledge-rag-postgres--pgvector).
- `lib/embeddings/` — Ollama embeddings. `text.ts` is pure (token estimation, normalization, head/tail truncation, context-length retry parsing) and unit-tested; `dimensions.ts` holds `EmbeddingDimensionError` plus `assertEmbeddingDimensions` / `isEmbeddingDimensionError` and is pure and unit-tested — a typed error rather than message-matching, because the predicate has to recognise the provider's wording while this one is ours; `index.ts` is the `"server-only"` provider that calls both and re-exports them. `constants/embeddings.ts` holds `EMBEDDING_DIMENSIONS`, the index contract every vector store must match.
- `lib/generation/` — image generation on OpenRouter. `response.ts` parses the images response, drops the entries that carry no bytes, and names the file extension a media type implies — pure and unit-tested, and one `IMAGE_FORMATS` table rather than two maps so a type and its extension cannot drift; `markdown.ts` builds the reply's image markdown and is pure and unit-tested; `client.ts` is the `"server-only"` provider that POSTs and re-exports both. `constants/generation.ts` holds `DEFAULT_IMAGE_MODEL`, the request timeout and the aspect ratios the tool offers. See [Image Generation (OpenRouter)](#image-generation-openrouter).
- `lib/neo4j/` — the Neo4j driver. `config.ts` reads `config.neo4j` and is pure, returning null unless the URI *and* a password are present; `client.ts` is the `"server-only"` layer holding one lazily-built `Driver` plus `isNeo4jConfigured()`, so every caller degrades rather than throws.
- `lib/memory/` — the fact graph, and the only memory store. `graph-store.ts` is the `"server-only"` `MemoryGraphStore` and `sweep-runner.ts` its `"server-only"` sweep driver; `cypher.ts` holds every statement, out of the store so `scripts/check-memory.ts` can run the same Cypher the store does. `facts.ts` (the dedupe/supersede decision), `canonicalize.ts` (entity and predicate name normalization), `merge.ts` (the merge sweep's clustering), `recall.ts` (hop decay, recency, the seed-plus-path blend), `text.ts` and `pipeline.ts` (the recall read and its two expansion arms, extracted out of the store so the eval and its unit tests need no database) are pure and unit-tested; `eval-cases.ts` holds the fixed probe set, and `single-flight.ts` (the keyed in-process dedupe keeping a nudge and a cron pass from extracting one capture twice) and `capture-poll.ts` (the list's poll decision over the pending-capture count) are pure and unit-tested too. `nudge.ts` is the `"server-only"` `after()`-based shim scheduling one post-response sweep at each capture write site. `llm-facts.ts` is the extractor's schema and call, and `model.ts` the guardless extraction-model factory. `graph-view.ts` assembles one flat fact read into the drawn node/edge set and `graph-layout.ts` is a d3-force stepper the renderer ticks per frame — both pure and unit-tested, and both deliberately unaware of the canvas, so the decisions worth testing (which satellites survive the cap, what an edge is called, how big a node is, where a node starts, what "settled" means) need no browser. `d3-force` is the one runtime dependency this layer adds. `constants/memory.ts` holds the merge thresholds, the recall weights and the graph-view limits. See [Memory Graph (Neo4j)](#memory-graph-neo4j) and [Memory Graph View](#memory-graph-view).
- `lib/schedules/` — the scheduling subsystem. `cadence.ts` (cron and `once` next-occurrence), `retry.ts` (backoff, terminal error classes, the reaper's outcome and `isRunOpen`), `schedule-input.ts` (draft and patch parsing, and the next-run-after-patch rule), `input-form.ts` (a Zod schema into form fields, and the string-to-value coercer) and `input-schemas.ts` (the per-target input schemas) are pure and unit-tested. `registry.ts` holds the `TriggerExecutor` map every target kind registers into and registers nothing itself; `executors.ts` performs the executor imports and re-exports the registry, and is the module request-time consumers import from — importing `getExecutor` from `registry.ts` instead yields an empty registry that answers `invalid_target` for every target while the type-check and the unit suite stay green. `executor-workflow.ts` and `executor-agent.ts` are the two registered executors (`tool` is deliberately absent); `run-agent.ts` is the headless agent run the `agent` executor and the webhook service share; `dispatch.ts` runs one named run; `tick.ts` is the I/O layer that runs one pass. `lib/api/cron-guard.ts` is the `CRON_SECRET` bearer check the tick and the dispatch seam share. Execution is **at-least-once**: a claimed run holds a lease, and a run whose process died is handed back by the reaper rather than being lost. `constants/schedules.ts` holds the lease length, the retry curve and the tick's bounds. See [Scheduling](#scheduling).
- `lib/api/` — helpers for the route layer. `rate-limit.ts` (see [Redis](#redis)), `agent-api-auth.ts` (the API-key path), `cron-guard.ts` (the `CRON_SECRET` bearer check the tick and the dispatch seam share), and `query-params.ts`, whose `boundedInt` clamps a query integer. It takes a `min` because `Number(null)` is `0` and a Mongo `.limit(0)` means *no limit* — without a lower bound an absent `?limit` returns the whole collection rather than a page.
- `lib/redis-client.ts` — Shared ioredis connections, one per named consumer, with a per-consumer circuit breaker. `getRedisClient(name, options)` returns a discriminated result (`ready` / `unconfigured` / `circuit-open`) so each caller picks its own degradation policy. See [Redis](#redis).
- `lib/mongodb/` — MongoDB data layer using the official `mongodb` driver. `client.ts` provides synchronous collection accessors that connect lazily on first use. Most `*-store.ts` files hold exactly one document shape, but some span more — `workflow-store.ts` spans workflows, rich workflows and executions — and one collection can back several stores — `tools` backs `tool-store.ts`, `secret-store.ts` and `api-key-store.ts`.
- `lib/langchain/` — LLM orchestration layer:
  - `model-factory.ts` — creates LangChain `BaseChatModel` instances from model IDs. Central place for all provider wiring (Google and Ollama only — the `ProviderKey` union in `lib/types.ts` is the source of truth).
  - `model-config.ts` — `AVAILABLE_MODELS` array defining all supported models and their capabilities, plus `DEFAULT_MODEL_ID` used wherever a caller has no model of its own.
  - `chat-service.ts` — single-agent streaming chat, and the one service that binds MCP tools with no agent record scoping them. See [MCP Tool Binding](#mcp-tool-binding).
  - `agent-service.ts` — agent-based chat with tools.
  - `multi-agent-service.ts` — multi-agent orchestration (LangGraph supervisor).
  - `workflow-execution-service.ts` — runs automated workflow steps.
- `lib/auth/` — NextAuth.js config with the GitHub provider, role resolution from the `GITHUB_*_USERNAMES` allowlists (`role-resolution.ts`), and no token refresh — the session carries no provider tokens.
- `lib/tool/` — Tool system: `default-tools.ts` (built-in tools, and `resolveDefaultTool` — the one place a `default:`-prefixed name becomes a tool), `custom-tool-converter.ts` (user-defined tools). Three of the built-ins need the caller's identity, so they are factories rather than module-level singletons: `createKnowledgeBaseSearchTool` searches one owner's documents, and `createCodeSandboxTool` and `createGenerateImageTool` take the user and thread the request named. See [Image Generation (OpenRouter)](#image-generation-openrouter).
- `lib/stores/` — Zustand client-side stores (agents, threads, chat settings, sidebar, workflows, etc.).
- `lib/ai-actions/` — Server actions for agents, prompts, and tools.
- `lib/artifacts/` — the Artifacts store's writers. `save.ts` holds `saveToolArtifact`, which every type but one reaches through a tool-result envelope; `scancode.ts` is the exception, saving from the message text instead. That envelope has two shapes — a payload to upload, or a `StoredArtifact` carrying a `url` the producer already wrote — discriminated by the presence of `url`, so a producer holding bytes too large to put on the wire (see [Image Generation (OpenRouter)](#image-generation-openrouter)) reaches the same write path as one that hands them over. See [Scan Codes (```scancode)](#scan-codes-scancode).
- `lib/stats.ts` — the home screen's usage totals. `windowStartIso` and the `summarize*` functions are pure and unit-tested; the reads live on the stores owning each collection (`ChatHistoryStore.getUsageOverview`, `ArtifactStore.countArtifacts`), and all three are index-backed. `GET /api/stats` is session-scoped and returns the caller's own numbers alone, so it needs no RBAC gate. Agent counts are deliberately *not* in the payload — the home screen already loads the agent list for the composer's `@`-mention lookup. The token sum spans both `message` and `ai_usage` discriminators, because they share the `history` collection and summing one would undercount.
- `lib/conversation.ts` — pure helpers shared by the four conversation surfaces: last-assistant detection, the standalone loading-message builder and its predicate. Unit-tested; see [Conversation Surfaces](#conversation-surfaces).
- `lib/image-view.ts` — the image preview's pan and zoom arithmetic, and the zoom limits. A view is a scale about the frame's centre plus a translation, so it is the one transform `translate(x, y) scale(scale)`; `zoomImageAt` moves the picture so whatever the pointer is on stays under it, and both it and `panImage` bound the translation so the picture's own edge cannot pass the frame's. Pure and unit-tested — the preview component measures the two boxes and hands them over, so none of this needs a browser.

### Client-Side Patterns

- **State management**: Zustand stores in `lib/stores/` with `persist` middleware for local storage. Auth store in `lib/auth/store.ts`. Machine state store in `lib/stores/machine-state-store.ts`.
- **Data fetching**: TanStack React Query. Custom hooks in `hooks/` (`use-*-queries.ts` pattern) wrap API calls with query/mutation logic.
- **Chat hooks**: `hooks/use-chat.ts` (standard), `hooks/use-agent-chat.ts` (agent), `hooks/use-multi-agent-chat.ts` (multi-agent), `hooks/use-arena-chat.ts` (arena mode) — the four stream hooks described in [Conversation Surfaces](#conversation-surfaces).
- **Navigation**: Permanent 64px icon rail (`components/layout/nav-rail.tsx`) with flyout groups. Machine State panel (`components/chat/machine-state-panel.tsx`) provides inspector panel on conversation routes.
- **List-page frame**: every list page is composed through `components/common/content-layout.tsx` — one title row carrying the action button and the search field, then a borderless filter strip, then the content. It is full-bleed by default (the rail to the right edge), so a form-shaped page has to opt back into the centred column with `width="bounded"` (only `app/(main)/auto/page.tsx` does). The filter strip comes from `components/common/content-filter-pills.tsx`, generic over the page's own tab union, so tab styling is not re-invented per page.
- **UI components**: `components/ui/` (primitives via Radix UI + CVA), domain components organized by feature (`components/chat/`, `components/agents/`, `components/workflow/`, etc.).
- **Rich text**: BlockNote editor for rich text input, React Markdown for message rendering (with remark-gfm, remark-math, rehype-katex, mermaid, syntax highlighting).
- **Styling**: Editorial monochrome system (cold neutral tokens in `globals.css`, neutral `--accent`), Newsreader serif, Inter sans, JetBrains Mono, near-square radii (`--radius: 4px`). Tailwind CSS v4 with `tailwind-merge` and `clsx`. Theme system via `next-themes` with custom `ThemeProvider`.
- **Path alias**: `@/*` maps to project root.

### Conversation Surfaces

Four routes render a conversation — `/chat/[id]` (plus `components/chat/new-chat-page.tsx` for `/chat/new`), `/agent-chat/[agentId]/[threadId]`, `/multi-agent-chat/[agentId]/[threadId]` and `/swarm-chat/[threadId]`. They share one render tree and one set of effects rather than four copies of each:

- `components/chat/conversation-shell.tsx` — the `ConversationShell` render tree: scroll area, `MessageItem` list, standalone loading indicator, composer block. Two layouts (`plain`, `sidePanel`) and three slots (`slotBeforeMessages`, `slotAfterMessages`, `overlay`). Its `ConversationHandlers` are all optional, and an absent handler is what makes `MessageItem` omit the corresponding affordance — which is how swarm renders exactly the same list with no regenerate, edit, version or feedback controls.
- `hooks/use-conversation-shell.ts` — the `useConversationShell` effects: auto-scroll, agent names, last-assistant detection, the loading message, regenerate and edit-submit, the optimistic thread record, and the pending-message handoff. Each surface supplies only what differs: `threadDefaults`, `dispatchPending`, `onPendingLatched`, and the gates below.
- `lib/conversation.ts` — the pure parts, unit-tested.

**The four hooks stay four hooks.** `useChat`, `useAgentChat`, `useMultiAgentChat` and `useSwarmChat` are not merged, because React forbids conditional hooks and each surface must call its own. They do share one `sendMessage(attachments, options?)` contract (`SendMessageOptions` in `lib/types.ts`), so a call site reads the same on every surface.

The pending-message handoff is deliberately two effects. The first latches the payload into refs, registers the optimistic thread record and sets the input; the second sends, once the input state it set has been committed — which is why the send can see the text. Its guards are load-bearing: a one-shot `pendingMessageSent` ref so a re-render cannot re-fire it, `!isLoading` and `messages.length === 0` so a stale pending entry alongside existing messages sends nothing, and `(input || attachments.length > 0)` so an attachments-only send proceeds.

Two options exist because chat is the only surface that needs them: `extraScrollDependencies` (chat also scrolls on research-state, status-history and report-length changes) and `shouldRegisterThread` (chat's thread record is written by the send for a not-yet-persisted conversation, so the shell must not register one there — its `threadId` is the empty string in that case). `clearDelayMs` preserves swarm's 1000 ms pending-clear window.

**Regeneration appends a version, up to a cap.** Regenerating adds to `message.versions` rather than replacing, so `MAX_MESSAGE_VERSIONS` (`constants/config.ts`) bounds it. `hasReachedVersionLimit` (`lib/conversation.ts`) is the one predicate; the stream pipeline refuses a regeneration past the cap *before* calling the model (so a refused attempt costs no tokens), and `MessageActions` disables the control with the reason as its title. **The hooks' `error` is rendered**, by `ConversationShell` above the composer — a rejected stream (a rate limit, a refusal) was invisible, which makes a broken control look like one that does nothing. `handleRegenerate`'s guards report through a toast for the same reason.

### MCP Tool Binding

Every surface that can call an MCP tool resolves the connectors it will connect
to through `filterConnectors` (`lib/api/stream/tooling.ts`), which drops disabled
connectors and resolves their stored secrets. What differs is the required-tool
list each surface hands it. Agent, multi-agent and swarm pass the agent records'
own `tools`, so a connector is reachable only where an agent names it. **Default
chat passes `includeAllEnabled` and binds every enabled connector** — it is the
one surface with no agent record to scope them with, and no configuration of its
own in which a narrower choice could be expressed. It binds every enabled custom
tool for the same reason. This is a deliberate cost: each chat request opens a
client against each enabled connector and lists its tools.

`chat-service.streamChat` owns its MCP client and releases it in a `finally`, so
a throw, the streaming fallback, or a consumer that stops iterating cannot leak
the connection; `agent-service` owns its client the same way. One name resolves
to one tool, in a fixed precedence — the built-in defaults win outright, then
connectors, then the user's own tools — because two tools sharing a name reach
the model as a single ambiguous choice.

**The built-in defaults follow the same split.** Agent, multi-agent and swarm
bind the tools their agent records name, resolved through `resolveDefaultTool`.
Default chat binds `web_search`, `code_sandbox` and `generate_image` outright —
it has no agent record to scope them with. `generate_image` is bound only where
there is a user id to own the result and pay the provider, and its name is
reserved against the user's own tools along with `knowledge_base_search`, whose
per-request factories have left `defaultToolsMap` and so are no longer covered by
the duplicate-name check that reads its keys. `generate_image` is deliberately
absent from `RESOLVABLE_DEFAULT_TOOLS`: a workflow step never reads the artifact
envelope and has no conversation to render into, so the picture would be paid for
and dropped.

See [Conversation Surfaces](#conversation-surfaces) for the four surfaces that
render a conversation.

### Authentication Flow

Middleware in `proxy.ts` (not `middleware.ts`) protects all routes except `/login`, `/api/auth`, `/api/agents/v1`, and static assets. GitHub OAuth with JWT strategy, 30-day sessions. There is no token refresh — a GitHub OAuth App token does not expire and issues no refresh token, so the session carries no provider tokens. Roles are resolved from the `GITHUB_ADMIN_USERNAMES` / `GITHUB_MANAGER_USERNAMES` / `GITHUB_VIEWER_USERNAMES` allowlists, with the role already stored on the user record taking precedence; an unlisted login falls back to the default role.

### Environment Variables

Required: `MONGODB_URI` (and optional `MONGODB_DB_NAME`, defaulting to `geniechat`). In production, also requires `NEXTAUTH_SECRET` (>= 32 chars), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SECRET_ENCRYPTION_KEY`, `CRON_SECRET`, `REDIS_URL`, `POSTGRES_URL`, `NEO4J_URI`, `NEO4J_PASSWORD`. Chat, embeddings and web search need `OLLAMA_API_KEY` (for Ollama Cloud) and `EXA_API_KEY`; `GOOGLE_API_KEY` enables the Gemini models. `GITHUB_ADMIN_USERNAMES`, `GITHUB_MANAGER_USERNAMES` and `GITHUB_VIEWER_USERNAMES` are optional — an unset allowlist grants nobody that role, and a role already stored on the user record still takes precedence. `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` configure object storage and are optional as well: `S3_PUBLIC_ENDPOINT` is a second endpoint because SigV4 signs the Host header, so a URL presigned against an internal service name fails in a browser that resolves that name differently, and `S3_REGION` must match Garage's `s3_region` or every signature fails validation. `DOCLING_SERVE_URL`, `DOCLING_SERVE_API_KEY` and `DOCLING_SERVE_TIMEOUT_MS` configure the document-parsing sidecar and are optional too — see [Document Parsing (Docling)](#document-parsing-docling). `NEO4J_URI` and `NEO4J_PASSWORD` are required in production and are how the memory graph is reached; a blank `NEO4J_URI` is treated as unconfigured, so memory degrades to nothing rather than to a failed call. `OPENROUTER_API_KEY` backs the embedding provider and image generation, and `OPENROUTER_EMBEDDING_MODEL` the embedding model. All other vars are optional. See `lib/env.ts` for the full schema.

**When adding a new env var:** update all four — `lib/env.ts` (schema + `superRefine` if prod-required), its `buildPlaceholders` map if prod-required (otherwise `pnpm build` fails validation, since `next build` runs with `NODE_ENV=production`), `.env.example` (value + comment), and the deployment environment's configuration if prod-required.

### Redis

One `REDIS_URL` connection string feeds both Redis consumers — rate limiting (`lib/api/rate-limit.ts`) and deep-research checkpoint caching (`lib/mongodb/deep-research-store.ts`). Each gets its own named client from `lib/redis-client.ts`, because they want opposite failure behaviour: the rate limiter fails fast and rejects with a 503 when Redis is down, while the checkpoint cache fails soft to MongoDB. `RateLimitResult.storage` is the one field on either interface that no caller reads.

`docker compose up -d` starts a local Redis for development (`docker-compose.yml`, loopback-only, no password). Production must point `REDIS_URL` at a Redis the app can reach over the network — the app does not host one itself, so that means a managed service, a container, or a VM. TLS is selected by the `rediss://` scheme; credentials go in the URL's userinfo.

### Object Storage (Garage)

Chat attachments, generated images, agent documents and deep-research reports live in self-hosted Garage behind the S3 API. Documents store a canonical `s3://bucket/key` ref rather than a durable URL, and every read presigns a fresh URL from that ref — so a shared link expires (`STORAGE_TTL` in `constants/storage.ts`), and a rotated key invalidates every outstanding presigned URL while the stored reference itself stays intact. See [Server-Side Core](#server-side-core-lib) for the module layout.

`docker compose up -d` starts a single-node Garage alongside Redis (`docker-compose.yml`). The six buckets — `chat-documents`, `chat-images`, `reports`, `agent-documents`, `generated-images` and `artifacts` — are ensured and granted to the application key by `scripts/garage-bootstrap.sh`, run by the `garage-bootstrap` compose service; it is idempotent and verifies the grant count rather than trusting `bucket list`. **A running Garage does not pick up a bucket added to that list later** — the service only runs at `compose up` — so a bucket added since the last bootstrap has to be created by re-running the service, or every write to it fails with `NoSuchBucket`. Garage's S3 API port (3900) is bound to all interfaces because **the browser, not only the app, fetches presigned URLs**; the web UI and admin API stay loopback-only.

`garage.toml` ships a development-only fixed `rpc_secret`, and **any deployment beyond local development must generate its own** — the committed value is safe here only because the RPC port is unpublished locally. In production Garage must likewise be reachable by the **browser**, not only the Web App, for the same presigned-URL reason; `S3_PUBLIC_ENDPOINT` is how those two addresses are told apart.

### Image Generation (OpenRouter)

`generate_image` is a built-in tool rather than a surface of its own: the model
calls it inside an ordinary conversation, and the picture appears in the reply.
There is no model picker and no separate chat — a selector would put a
model-catalogue decision in front of a user who asked for a picture, and the
tool's optional `model` argument is the escape hatch for the one case that needs
one, a user who names a model. Everything else uses `DEFAULT_IMAGE_MODEL`
(`constants/generation.ts`).

**The tool uploads its own bytes and returns a ref, not the image.** The result
of a tool call is both streamed to the client and persisted in the thread
document, and an image is megabytes of base64; routing the bytes through the
artifact envelope would put them on the wire and in Mongo twice. So the tool
decodes, uploads to Garage under `generated-images` on a `userId`-scoped key, and
returns the `s3://` ref plus the markdown that renders it. `putObject` gained an
optional content type for this: an object stored without one comes back from
Garage as `binary/octet-stream`, leaving the browser to guess at bytes whose
format the provider declared.

**The reply's markdown points at the download proxy, not at a presigned URL.** A
presigned URL expires, and the reply outlives any one signature, so the markdown
carries `/api/storage/download?ref=…` — which presigns afresh on every read and
checks ownership before it does. The alt text is built by `markdownImageFor`
(`lib/generation/markdown.ts`) rather than by the model: a prompt containing `]`
or a newline would otherwise truncate the markdown the model is told to echo
verbatim, and a broken image is worse than a boring caption.

Rendering needs nothing new. The markdown `img` handler in
`components/common/markdown-renderer.tsx` already draws a generated image through
`ImageBlock`, so the picture and the artifact card come from the same markdown
every other image in a reply does.

The tool is chat's alone and the model owns its own record: it is bound per
request (`chat-service.ts`), and it is not in `RESOLVABLE_DEFAULT_TOOLS`, so a
workflow or agent step cannot reach it — see [MCP Tool Binding](#mcp-tool-binding).

**Video is not implemented.** OpenRouter's video endpoint is an asynchronous job
rather than a call — submit, poll for the job, fetch the content — which needs a
job record, a poll, a `video` artifact type and a player, so it layers on behind
the same tool shape when it is built.

### Knowledge RAG (Postgres + pgvector)

Agent- and chat-document retrieval runs on PostgreSQL with pgvector. One table, `knowledge_chunks`, is keyed by `(owner_type, owner_id)` where the owner is an agent or a chat thread; `user_id` is stamped on every row and `source_id` names the originating document, so deleting one uploaded document removes only its chunks.

Retrieval is one statement: a pgvector cosine branch and a Postgres full-text branch over the generated `content_tsv` column, `LEFT JOIN`ed back to the rows so either arm can contribute, then fused by `combineRrf` (`lib/knowledge/ranking.ts`). Fusion uses ranks, not scores, which is why a cosine distance and a `ts_rank_cd` never need normalising. The lexical branch uses `websearch_to_tsquery`, not `to_tsquery` — the query is user text, and `to_tsquery` raises a syntax error on `(` or `&`. Each branch carries an explicit `ORDER BY` above its `ROW_NUMBER()` window, because it is the `ORDER BY` that decides which rows the `LIMIT` keeps.

**`user_id` is the authorization boundary and the owner is not one.** An agent id is not a secret — the agent stream route hands the model whichever agent id the request named without checking that the caller owns it — so both branches of the search filter on `user_id`, and `searchKnowledge` takes a required `userId` for that reason.

Writes use **replace semantics**: `indexChunks` deletes and reinserts inside one transaction, so re-running a backfill or re-uploading a document cannot double rows. The delete is scoped by `source_id` when the caller names a document, because a chat thread's chunks are all of its documents' chunks — an owner-wide delete would make a thread's second upload wipe the first. A source-less call still clears the whole owner. A chunk whose embedding fails is stored with a null vector and stays reachable through full-text search; the query side mirrors that, degrading to the lexical arm alone when the query embedding fails — **but only for an outage**. A width mismatch throws instead (`isEmbeddingDimensionError`, `lib/embeddings/dimensions.ts`), on the grounds that a query vector which can never match the stored ones would present a broken index as a working one. Embedding happens before the transaction opens, not inside it: the delete holds row locks on the owner, and one HTTP round trip per chunk is a long time to hold them. That ordering also means a width mismatch throws before the delete, leaving the previous index intact rather than replacing it with vectorless rows.

Deleting a document deletes its chunks, and a stored object is no longer enough to remove a document: `DeleteChatDocument` clears the document row and the chunks together, scoped by `source_id` and by the owner tuple read from the document itself — an agent upload carries an `agentId` and no thread, so a hardcoded chat owner would find nothing and orphan the chunks. `app/api/agents/files/route.ts` calls it before pruning the agent's document list, and the outcome decides whether the entry stays: a genuine failure keeps the file listed so the retry is meaningful, while `NOT_FOUND` is success, because the file is attached whether or not its text could be parsed, the stored object is already gone by then, and retaining the entry would strand it with nothing left to clear.

`pnpm db:setup:pg` creates the schema and indexes. `pnpm knowledge:check` exercises the store end to end against a live database. `pnpm knowledge:backfill` re-chunks and re-embeds documents already in MongoDB.

### Memory Graph (Neo4j)

Memories are a fact graph in Neo4j and nowhere else. Six node labels carry
everything: `:User` (the anchor every personal fact hangs off, and the only place
a name and email live), `:Entity`, `:Predicate`, `:Value`, `:Fact` and
`:Capture`. A fact is three edges rather than a row — `SUBJECT`, `PREDICATE` and
`OBJECT` — so "same subject, same predicate" is an identity test rather than a
similarity one.

**A fact is closed, not deleted.** Superseding sets `isCurrent = false` and
`validTo`, which is what lets recall render a changed fact as dated history
instead of losing it. `isCurrent` is denormalized onto the node so the vector
seed can test it *inside* the `SEARCH`: an index filters only on a property it
declares, so `fact_embedding` declares `[f.userId, f.isCurrent]`.

**Tenant isolation is a `userId` property, checked inside the query.** Neo4j has
no collection scoping, so the boundary lives in the `MATCH` clauses: the seed
`SEARCH` filters in-index (`WHERE f.userId = $userId AND f.isCurrent = true`
inside the `SEARCH`, not after it — a post-filter would let another tenant's
nearer matches consume the top-K), and `FACT_EXPAND_CYPHER` re-checks `userId`
on every node of every hop, so a shared `:Entity` can never bridge two users.
The in-index `WHERE` is a restricted subset — equality and `AND` only; an `OR`, a
`<>` or a string operator fails with error 22ND3.

**`:User` is excluded from expansion outright** (`NOT any(x IN nodes(path) WHERE
x:User)`). Every personal fact hangs off the anchor, so fact→user→fact would
reach the whole corpus in one hop. The cost of that refusal is that two
attributes of the same person are mutually unreachable — the extractor makes the
person the *subject* of every fact about them, and two attributes share no
object — so asking about a diet never surfaced the height the assistant had been
told. `FACT_ANCHOR_EXPAND_CYPHER` buys that reach back under a cap: the user's
newest current facts, reached through the anchor, bounded by
`MEMORY_ANCHOR_EXPAND_LIMIT` and weighed at `MEMORY_ANCHOR_PATH_WEIGHT` (a
shared anchor is the weakest link the graph has — it says only that the user
said both things, never that they belong together, so profile facts rank *below*
the facts the question actually matched). The traversal's refusal is untouched:
the anchor has one bounded arm of its own, not a route through the traversal.

**The write path is capture → nudge → sweep → materialize, and the capture is
durable first.** `captureSentence` writes a `:Capture` node and returns before
any model sees it, so "Memory saved" is honest even though extraction has not
run. Both write sites — the `save_memory` tool and `POST /api/memories` — then
call `nudgeMemorySweep` (`lib/memory/nudge.ts`), which schedules one sweep for
that user with Next's `after()` once the response is finished. The store's
`sweep`, driven by `sweep-runner.ts`, then extracts, canonicalizes, dedupes and
supersedes. The nudge and the cron pass share one per-user entry point,
`sweepUser`, keyed through an in-process single-flight map
(`lib/memory/single-flight.ts`), so a nudge racing a pass on one instance shares
one extraction instead of running two. **The external driver is still the retry,
not the only mechanism:** `POST /api/memories/sweep` on the `CRON_SECRET`
endpoint re-runs a capture whose extraction failed, or that was saved while no
process was there to nudge — at-least-once, the same rule as
[Scheduling](#scheduling). `after()` is fully supported self-hosted with `next
start`; it is unavailable under a static export, which this app does not build.
A second app replica keeps its own single-flight map and can still overlap; that
residual is at-least-once and is absorbed by `decideFactWrite`'s
identical-object noop.

**The list reports what is still pending, and the client polls on it.** A
capture is staged before any model sees it, so a save returns success with no
fact in the page — and the page cannot say when one will exist. `listFacts`
therefore returns a third number beside the page and the total: the count of
captures still under `MEMORY_CAPTURE_MAX_ATTEMPTS`, from
`CAPTURE_PENDING_COUNT_CYPHER`. `capturePoll` (`lib/memory/capture-poll.ts`, pure
and unit-tested) turns that count into a refetch delay, so `useMemories` reads
again while work is outstanding and stops when it is not — the signal terminates
on its own, which a fixed window after the save cannot do. `MEMORY_CAPTURE_POLL_MAX_MS`
bounds the one case it cannot see: a deployment whose sweep never runs, where the
count would stay above zero forever. The list and the graph both read with
`staleTime: 0`, since any cached page is a snapshot of a graph that is
mid-change; the graph carries no poll, because a re-read rebuilds a force layout
the reader is in the middle of looking at and its tab is opened deliberately.

Recall is a vector seed plus **two expansion arms**, ranked in TypeScript
(`lib/memory/recall.ts`, composed by `pipeline.ts`): the seed's cosine score and
the path weight, decayed per hop, plus a recency bonus, with a seed below
`MEMORY_SEED_SCORE_FLOOR` dropped **before** expansion. One arm is the entity
traversal (`FACT_EXPAND_CYPHER`) and the other the bounded anchor hop
(`FACT_ANCHOR_EXPAND_CYPHER`, above); the two are independent, so they run
together under `Promise.allSettled` and each degrades to nothing on its own
failure rather than discarding the seeds. The entity arm's rows merge first, so a
fact both arms reach keeps the question-matched attribution rather than the
anchor's weaker one. `mode` reports which half *contributed* — an expansion that
ran and returned nothing leaves it `"vector"`. Seeds are vector-only,
and a pending `:Capture` is seeded too, so a sentence saved a second ago is
already recallable. No seeds, or any error, returns an **empty** result with
`mode: "vector"`, never `slice(0, top)`, because the first `top` rows of a
corpus are not an answer to a question. An unconfigured or unreachable Neo4j is
an error for CRUD rather than a silent empty list: memories *are* the feature, so
the store being down has to surface as a failure.

Two structural notes. `lib/memory/cypher.ts` holds every statement specifically
so `scripts/check-memory.ts` can execute the same Cypher the store does — the
store is `"server-only"`, a check script cannot import it, and a script carrying
its own copy would be verifying the copy. That script's last check `EXPLAIN`s
every exported statement, which is the only cover a statement no other check runs
has; clause order is the reason it earns its place, since Neo4j accepts
`ORDER BY` / `OFFSET` / `LIMIT` in that order alone and reports a wrong one as a
*syntax* error, invisible to the type-check and to a unit suite that never
executes Cypher. And the `"server-only"` guard does not resolve under `tsx`,
which is why `cypher.ts`, `pipeline.ts` and `model.ts` carry no guard and hold no
connection, while the scripts build their own driver. Cypher cannot parameterise
a variable-length bound, so `FACT_EXPAND_CYPHER` interpolates
`MEMORY_RECALL_HOPS`, which is verified as a positive integer at import.

Nothing writes `:Memory` nodes any more, and `buildNeo4jDdl` creates no index or
constraint for the label. Legacy prose nodes still exist in live databases, and
two scripts depend on the orphan GC sparing what they point at: the `ABOUT` arm of
`buildOrphanGcCypher` is what stops the GC deleting the entities those nodes
mention, and `scripts/drop-memory-nodes.ts` reaches them through that arm.
`pnpm memory:drop-prose` is the removal path — it drops the nodes along with the
index and constraint an older schema created for them.

`pnpm db:setup:neo4j` creates the constraints and vector indexes. `pnpm
memory:check` exercises the store against a live graph, and `pnpm memory:eval`
scores recall against the fixed probe set.

**That setup script creates each vector index with `IF NOT EXISTS`, so it is a
no-op against an index that already exists — including one whose internal state
has drifted.** A drifted index raises `Neo.DatabaseError.Statement.ExecutionFailed:
Index N out of bounds for length 1` for a filtered `SEARCH` that matches **no**
rows, where a healthy one returns none. `fact_embedding` filters on
`(userId, isCurrent)`, so an empty match there is the new-user path and the
user whose facts are all closed; a seed failure discards the whole recall, so it
surfaces as `Failed to load user memories` with the pending capture lost with
it. `memory:check`'s seeding check seeds again after closing its fixture's only
fact, which is that empty match — a failure there is the drift, not the closure.
The repair is to `DROP INDEX` the index and recreate it from the same statement
in `buildNeo4jDdl`.

### Memory Graph View

`/memories` has a List / Graph toggle. The graph is read through
`GET /api/memories/graph`, which is session-scoped like every other memory route,
and assembled by `buildMemoryGraphView` from `lib/memory/graph-view.ts`.

**Five node kinds and three edge kinds.** A fact is a node, and its subject,
predicate and object are three more reached by three separate edges. `:Entity`,
`:Predicate` and `:Value` all MERGE on a per-user key, so a satellite is genuinely
shared across the facts that mention it and the satellites *are* the hubs —
nothing computes communities, because the clustering is already in the data.

**The `:User` anchor is drawn, pinned at the canvas centre.** The extractor names
the person themself as the subject of every sentence about them, so the anchor is
the subject of most facts and is the one thing that says whose graph this is. Its
star of degree *n* is what the layout is built to hold: the canvas pins it at the
centre once the simulation is seeded, so a fact that hangs off it keeps its
subject edge and the picture reads as everything around the reader. `forceCenter`
translates pinned nodes too, but the anchor is the centroid of its neighbours, so
the drift is nil. Recall's separate rule not to *traverse* through `:User` is
untouched — that one is about the read, not the drawing.

**The read is two round trips.** `GRAPH_FACTS_CYPHER` picks the window — newest
first, capped at `MEMORY_GRAPH_FACT_LIMIT` — returning each fact with its three
satellites flattened into one row, which is what lets a single pattern produce
exactly the edges whose endpoints are drawn. `FACT_COUNT_CYPHER` supplies the true
total, because the truncation notice cannot be inferred from "the read returned
exactly the limit" — that reports truncation for a user who has exactly that many
facts. Both hit indexes that already exist, so the drawing carries no schema of
its own.

**Two ceilings, bounding different things.** `MEMORY_GRAPH_FACT_LIMIT` (1000)
bounds the read; `MEMORY_GRAPH_NODE_LIMIT` (3000) bounds the drawing. The second
is reached only when facts carry mostly unique satellites: past it the
lowest-degree satellites are dropped, ties broken by label then id so the dropped
set is the same on every read, and **facts and the anchor are never dropped** — a
fact is what the reader came for, its satellites are what connect it to the rest,
and the anchor is the centre the whole picture is read around.

**The layout is a stepper the renderer drives.** `lib/memory/graph-layout.ts`
seeds every node on a golden-angle spiral — assigned explicitly rather than left
to d3's own initialization, so the picture is deterministic and a remount never
reshuffles it — and returns a d3-force simulation the renderer ticks once per
frame while `alpha` is above `MEMORY_GRAPH_ALPHA_MIN`, then paints once more and
stops. `forceSimulation()` starts a timer of its own the moment it is
constructed; the module stops it and never calls `restart()`, so d3 and the
renderer cannot tick the same nodes at once. The simulation runs on the **main
thread**: a Barnes–Hut tick at ~2000 nodes is 1–3 ms, well inside a frame, and a
worker would add a per-frame structured clone that costs more than the tick it
saves. Past that, the upgrade is a worker behind the same stepper interface, with
no change to any consumer.

**Identity is never colour-alone.** Node kind is shape — a ring is the user
anchor, a rounded square a fact, a circle an entity, a diamond a predicate, a
smaller circle a value — and size, degree growing the radius, as well as colour;
edge kind is line style. The colours are `--chart-1` through `--chart-5`, the
repo's own categorical and colorblind-validated palette (the anchor takes
`--chart-5`), chosen over the semantic `--red`/`--green` tokens because those
carry error and success meaning everywhere else and must not be spent on a node
kind. The legend, the detail card and the keyboard announcement each name the
kind in words. The canvas reads the tokens with `getComputedStyle`
at runtime — `ctx.fillStyle` cannot take a `var()` — through
`hooks/use-memory-graph-palette.ts`, which re-reads on the resolved theme, so a
cached colour from the previous theme is never drawn.

**A canvas forces an accessibility contract.** There is no DOM to read, so the
canvas carries `role="img"` and a summary label; it is focusable and walks the
nodes in degree-descending order, capped at `MEMORY_GRAPH_KEYBOARD_LIMIT`, with
the focused node announced through an `aria-live` region and Enter opening its
detail card. Labels are suppressed below `MEMORY_GRAPH_LABEL_ZOOM` and for
low-degree nodes — that is what makes thousands of nodes legible rather than grey
mush, because the picture is dots until the reader zooms in or points at
something. The List tab remains the full non-visual surface.

**`scripts/check-memory.ts` covers both statements**, since the store is
`"server-only"` and the script is the only thing that executes the same Cypher.

### Scheduling

Two documents, and the split is the feature. A **`Schedule`** is the user's
intent — "every weekday at 9am, run this workflow with this input" — and a
**`ScheduleRun`** is one attempt at it. They are separate because retries and
history need a record per attempt: rolling them into one document makes "last
status" the only thing expressible. `runs`
carries the attempt state machine (`pending` → `running` → `succeeded` /
`failed`, with `skipped` and `cancelled` for the paths that never execute),
while `schedules` carries the intent plus `nextRunAt` and a `skippedRuns` count.

**Nothing runs on a timer inside the app.** `POST /api/schedules/tick` runs
`runTick` once and returns; the driver is whatever calls that endpoint on a
schedule. That is what makes the subsystem portable — the same code runs on a
container, a serverless function or a laptop, and the app never assumes a
long-lived process.

**The cost of that design is that a repo with no driver has schedules that never
fire, and nothing says so.** `docker-compose.yml` therefore ships a
`schedule-tick` sidecar: a pinned `curlimages/curl` looping on the endpoint once a
minute, reaching the app through `host.docker.internal` because `pnpm dev` runs on
the host and is not a compose service. It authenticates with `CRON_SECRET` from
`.env` — the same value the app reads, so the two must agree or every tick is a
401. It is a development convenience with no part in a deployment, which supplies
its own driver.

`runTick` is five phases, in order, and the order is load-bearing: **reap**
(a run whose lease lapsed belongs to a process that died — this is what makes a
killed invocation a retry rather than a lost run), **claim due schedules**,
**create or skip runs**, **claim due runs**, **execute with bounded
concurrency**. Retries need no second mechanism: a run due for retry is simply
due work phase 4 already found.

**Two claims, both a single `findOneAndUpdate`.** A schedule is claimed by
compare-and-swapping its own `nextRunAt`, because advancing it *is* part of
claiming it — a claim that left `nextRunAt` alone would find the same schedule
due again on the next iteration. A run is claimed by flipping `status` to
`running`, which is its own token. The returned document is the **pre-image**,
so a schedule's pre-claim `nextRunAt` is the run's `scheduledFor` with no second
read and no window in which two tickers see the same due schedule.

**The next occurrence is computed from `now`, never by adding a period.** That
one decision buys two things: `catchUpPolicy: "skip"` is free (a week of
downtime yields one occurrence, not a week of them), and DST is correct, because
the cadence carries its own IANA zone rather than a fixed offset. `cadence.ts`
is where both live.

**The zone is the browser's, and there is exactly one.** A cron cadence does store
the IANA zone the tick hands `cron-parser`, but the UI never asks for it:
`CadenceEditor` stamps the browser's zone onto the cadence it emits,
`schedule-form`'s submit stamps it again on the way out, and every display site
renders through `formatInstant` with the zone from `useBrowserTimezone`
(`hooks/use-browser-timezone.ts` — `useSyncExternalStore` with a `UTC` server
snapshot, because a zone read during render would otherwise hydrate the server's
against the browser's). A second selectable zone is a second clock to reconcile:
an expression typed against the user's own clock but filed under another zone
fires at an hour they never picked. A `once` cadence has no zone field — it is
one absolute instant, and its `datetime-local` editor is already read and written
by the browser in the browser's zone — so nothing is stamped for it and it is
rendered in the viewer's. `describeCadence` follows the same split, naming a
cron's own zone but rendering a `once` in the viewer's.

**The lease is the at-least-once boundary.** A claimed run holds a lease
(`leaseExpiresAt`) that the tick renews while it works. Past it another tick may
take the run back, and the reaper either returns it to `pending` with backoff or
fails it once `attempt >= maxAttempts`. So a run executes at least once, and a
crash costs a retry rather than a lost run — the tradeoff is that a slow-but-live
run may execute twice.

**`lib/schedules/registry.ts` is the only place the scheduler learns what a
target is.** Executors register by `TriggerTargetType`; the tick asks for one and
never branches on the kind. `getExecutor` returning `null` is what makes an
unimplemented kind answer `invalid_target` at save time rather than at 3am.
`workflow` and `agent` are registered; `tool` is a type the model already admits
and an executor that does not exist yet, which is deliberate.

**The registry is a module-level `Map`, so the side-effect import that fills it is
load-bearing — and it lives in one module.** `registry.ts` registers nothing
itself, so a consumer that imports `getExecutor` from it gets an empty registry
and every target answers `invalid_target` while both the type-check and the unit
suite stay green. Request-time consumers therefore import
`getExecutor`/`validateTarget` from `lib/schedules/executors.ts`, which performs
the executor imports and re-exports the registry's surface; `registry.ts` stays
pure so its unit test can register fake executors without the real ones in the
way.

**The API is CRUD over the two documents, plus two execution seams.**
`GET`/`POST /api/schedules` is the list and the create; `GET`/`PATCH`/`DELETE
/api/schedules/[id]` is one schedule; `POST /api/schedules/[id]/run` is "Run now";
`GET /api/schedules/[id]/runs` and `GET /api/schedules/[id]/runs/[runId]` are the
history; `POST /api/schedules/execute/[runId]` is the dispatch seam. Every route
but the seam is session-scoped, and the seam carries the `CRON_SECRET` bearer
check in `lib/api/cron-guard.ts` — the credential the tick already uses, because
its caller is a worker rather than a browser.

**The dispatch seam lives at `/api/schedules/execute/[runId]`.** `proxy.ts`'s
`publicPaths` is prefix-matched, so a seam under `/api/schedules/runs/` would
also exempt the session-scoped `GET /api/schedules/runs/[runId]` beside it; a
namespace created solely for the cron seam cannot accrete a session-scoped
sibling.

**`lib/schedules/run-agent.ts` holds the ownership check that
`AgentStore.getAgent` cannot.** That accessor is addressed by an unguessable id
and ignores its `userId` argument — the convention [Key
Conventions](#key-conventions) records — so the scheduler's agent run re-checks
`agent.userId !== userId` itself, and the webhook service's `executeAgentTarget`
reaches the agent through the same helper rather than keeping a second copy.

**The UI is three surfaces over that API.** `/schedules` is the list, built on
`ContentLayout` + `ContentFilterPills` like every other list page. The editor is
`app/(forms)/schedules/new` and `app/(forms)/schedules/[id]/edit`, and its live
"next runs" preview is `cadencePreview` — which validates before it enumerates,
and that is what lets it run on every keystroke of an expression the user has not
finished typing without throwing. `TargetSchedules` puts a target's own schedules
on the agent form in edit mode, and the edit page carries the run history, whose
"Run now" polls the one run it created until `isRunOpen` turns false.

**`expiresAt` on a run is a real `Date`, not an ISO string** — it backs a TTL
index, and MongoDB's comparison is type-bracketed, so a string bound would select
no BSON `Date` and the index would silently expire nothing. It is the same
exception [Key Conventions](#key-conventions) records for the webhook-invocation
`expiresAt`.

`pnpm db:setup` creates both collections and their indexes; `pnpm
schedules:check` exercises the seven properties that belong to the store rather
than to a pure function, and so cannot be unit-tested (a claim racing itself, a
run claimed by id racing itself, an expired lease, spent attempts, the last-run
status a settle writes, an overlap under `skip`, and a cleared description
leaving no key behind); `pnpm schedules:migrate` is a one-off that converts legacy
workflow cron triggers into `schedules`. See
[Server-Side Core](#server-side-core-lib) for the module layout.

### Document Parsing (Docling)

Document parsing runs on a self-hosted `docling-serve` sidecar (port 5001, loopback-only, since only the app talks to it), built from `scripts/docling.Dockerfile` to add the LibreOffice layer the published image omits — not for the legacy Office formats, which Docling 2.93.0 rejects with or without it, but for DrawingML/VML rendering inside DOCX. `DOCLING_SERVE_URL`, `DOCLING_SERVE_API_KEY` and `DOCLING_SERVE_TIMEOUT_MS` configure it and are optional: an unset or unreachable service degrades to empty extraction rather than blocking boot. The page cap and size cap that bound a conversion are container settings in `docker-compose.yml` (`DOCLING_SERVE_MAX_NUM_PAGES`, `DOCLING_SERVE_MAX_FILE_SIZE`) — both default to `sys.maxsize` upstream, so the compose file supplies the only limit there is.

### Scan Codes (```scancode)

A ```` ```scancode ```` fence renders a scannable symbol — a QR, a Data Matrix or a
linear barcode — from a small JSON config, alongside the mermaid, chart and
react-canvas fences. `lib/scancode.ts` is pure and unit-tested: it parses the
fence body, maps it onto bwip-js options, names the download, and scans a
finished message for complete fences. `components/chat/scancode-renderer.tsx` is
the only thing that imports the encoder on the client, so it rides in that
component's lazy chunk. `constants/prompt.ts` is what teaches the model the
fence, so a rename has to change both together.

**`barcode` is accepted as a fence name too** — by the renderer's dispatch and by
`extractScancodeFences`. Renaming in the prompt changes only what
the model is told from then on: it does not rewrite threads already on disk, nor
the earlier turns of the conversation the model is currently reading, so a model
that sees its own past `barcode` fences goes on emitting them. Without the alias
those messages render as raw JSON instead of a symbol.

**"Scan code", not "barcode":** a QR is a matrix, not a barcode, and the two are
different symbologies with different payload rules. Every file the fence produces
is named for both — `qrcode-example-com.svg`, `ean13-590123412345.svg` — because
a bare `barcode.svg` would misname the QR.

Symbols reach Artifacts automatically. `lib/artifacts/scancode.ts` reads the
finished message text and saves each fence it finds — nothing to click, because
the fence *is* the artifact and there is no tool envelope to read, unlike every
other artifact type. It **re-encodes the SVG from the fence's JSON** rather than
accepting markup from the client, so the stored bytes come from our own encoder
and a stored SVG is never a script vector; the browser and node builds of
bwip-js emit identical output, so the artifact matches the card. A fence the
encoder rejects — a bad EAN-13 check digit — is logged and skipped, since a
symbol that cannot be drawn must not become an artifact that cannot be scanned.
A content hash checked against the thread's existing scan codes makes a
regenerate idempotent. Like the tool-artifact write, it runs detached: storage
must not be able to fail a reply the user already has.

### Deployment

The app builds to a Next.js standalone bundle (`output: "standalone"` in `next.config.mjs`, which requires Windows Developer Mode or admin for local builds due to symlinks). Whatever hosts it must be configured for every backing service, since it hosts none of them itself: `REDIS_URL` — see [Redis](#redis) — `POSTGRES_URL` pointing at a reachable Postgres — see [Knowledge RAG (Postgres + pgvector)](#knowledge-rag-postgres--pgvector) — and `NEO4J_URI` / `NEO4J_PASSWORD` pointing at a reachable Neo4j — see [Memory Graph (Neo4j)](#memory-graph-neo4j). Neo4j Community Edition is single-instance with no clustering or online backup. Garage must be reachable by the **browser**, not only from the app, because presigned URLs are fetched directly — see [Object Storage (Garage)](#object-storage-garage).

The `docling-serve` sidecar is currently **local development only**, so a deployment has no `DOCLING_SERVE_URL` until a host for the sidecar exists. Until then nothing is parsed in production, and in chat that is deliberately not silent: plain-text attachments are still decoded directly because they bypass the sidecar, and a binary attachment produces a turn carrying an explicit notice that the file could not be read — so a misconfigured deployment makes itself visible in use rather than looking like a model that ignored the document. Agent documents go through the RAG path instead, where a conversion failure is logged and the document is attached unindexed. See [Document Parsing (Docling)](#document-parsing-docling).

**The scheduled-execution driver is an external cron pointed at `POST /api/schedules/tick`**, authenticated with the same `CRON_SECRET` bearer the app has always used. The app holds no timer of its own — the endpoint runs one tick and returns — so the driver can be a system crontab, a container scheduler or a serverless cron with no change to the app. `docker-compose.yml` ships one for local development (the `schedule-tick` sidecar — see [Scheduling](#scheduling)); a deployment supplies its own, and can override where the sidecar points with `SCHEDULE_TICK_URL`. The route is exempted from the session proxy in `proxy.ts`, because an external driver has no session; its own bearer check is the whole gate. **`/api/cron` does not exist** — a deployment still configured to call it gets a silent 404 rather than an alert, and its schedules simply stop firing. See [Scheduling](#scheduling).

**Memory materialization is nudged in-process and retried by the driver.** A memory saved through chat or the API schedules one sweep for that user with `after()` when the response finishes, so a capture becomes facts without anyone calling the endpoint — see [Memory Graph (Neo4j)](#memory-graph-neo4j). The external memory driver is still required: it is the retry for a capture whose extraction failed or whose nudge did not run, and the only mechanism if the app is ever deployed where `after()` cannot run. `docker-compose.yml` ships the `memory-sweep` sidecar for local development; a deployment supplies its own pointed at `POST /api/memories/sweep` with the `CRON_SECRET` bearer.

## Next.js 16 (Breaking Changes)

This project uses **Next.js 16**, which has breaking changes from earlier versions. Before writing or modifying any Next.js-specific code (routing, middleware/proxy, config, APIs), **read the relevant guide in `node_modules/next/dist/docs/`**. Key changes:

- **`middleware.ts` is deprecated → use `proxy.ts`** with `export function proxy()`. File must be named `proxy.ts` at project root.
- APIs, conventions, and file structure may differ from training data. Heed deprecation notices in the docs.

## Key Conventions

- **Unit tests:** Pure-logic functions in `lib/` must have unit tests in the matching path under `tests/lib/`. Use Vitest. Test files cover all exported functions; use factory helpers (not inline object literals) for complex types. Run `pnpm test` to verify. Files that require I/O (MongoDB, Redis, S3 (Garage), LangChain services) are integration-test candidates — do not unit test them with mocks.

- **MongoDB documents:** `_id` carries the string id from `generateId()`
  (uuidv7) — never an ObjectId. `lib/mongodb/common.ts`'s `hydrateDocument()`
  is the place `_id` becomes `id`; use it on every read. The one deliberate
  second site is `toUserRecord` (`user-store.ts:31-34`), which performs the same
  conversion for the `users` collection — `hydrateDocument`'s `LacksMongoId` guard
  (`common.ts:38`, applied at `:45`) is what keeps the two from drifting.
- **Dates are stored as ISO 8601 strings**, not `Date` objects, because ISO
  strings sort lexicographically in chronological order and queries depend on
  that. **Three stored fields are the exception, all real `Date`s**: the
  webhook-invocation `expiresAt` (its TTL index requires one) and `createdAt` on
  `ChatDocument` and `ChatCitationDocument` (`lib/mongodb/common.ts:254`, `:278`
  — stored documents that are never API responses). **Do not compare an
  ISO string against one of these**: MongoDB's comparison is type-bracketed, so a
  string bound selects no BSON `Date` and the query silently matches nothing.
- API routes stream responses using async generators yielding typed event objects (`{ type: "token" | "tool_start" | "tool_end" | ... }`).
- **Collections are scoped by `userId`.** MongoDB has no partition key, so a query
  that omits `userId` on a user-scoped collection is a cross-user read. Where a store
  method is addressed by the owning user, `userId` comes first
  (`threads_userId_lastMessageAt` is `{ userId: 1, lastMessageAt: -1 }`).
  **This is a convention, not an invariant the store layer enforces.** Accessors
  addressed by an unguessable identifier take no `userId` at all — `getTool(toolId)`,
  `getConnector(serverId)`, `deleteThread(threadId)` — and ownership for those is
  enforced by hand at the route, which makes that route check load-bearing rather
  than belt-and-braces. The memory store is the counter-example: `getFact(userId,
  id)` and `deleteFact(userId, id)` carry the boundary themselves — the graph is
  queried with the owner in the `MATCH` — so `app/api/memories/[id]/route.ts` needs
  no ownership check of its own and another user's fact reads as a 404. It is also
  the one store with no update path: a fact is derived from a captured sentence, so
  a correction is a new sentence and the supersede rule closes the one it replaces.
  Two nearby accessors are
  guarded differently rather than by ownership: `getAllUsers()` takes no argument at all
  and sits behind RBAC (`app/api/admin/users/route.ts`'s `requirePermission("users:manage")`),
  and `findByHash(hash)` is the API-key authentication path, where the hash *is* the
  credential (`api-key-store.ts:78`, reached from `lib/api/agent-api-auth.ts:37`). Nor is
  `userId` always first when both are present (`getById(id, userId)`,
  `getTask(taskId, userId)`), and not every index on a user-scoped collection leads with
  it — `documents_type_chatThreadId_isDeleted` is `{ type: 1, chatThreadId: 1,
  isDeleted: 1 }`.
- The `config` object in `lib/config.ts` is the single source of truth for service configuration — never read `process.env` directly in application code outside `lib/env.ts`.
- ESLint treats `@typescript-eslint/no-explicit-any`, `prefer-const`, and `react/no-unescaped-entities` as warnings, not errors.
- Server-only code uses the `"server-only"` import guard.
- Logging uses `pino` via `lib/logger.ts` (with `pino-pretty` in dev).
- **Colors:** Only use CSS custom properties defined in `app/globals.css` (`--blue`, `--blue-bg`, `--blue-border`, `--purple`, `--green`, `--red`, `--amber`, `--accent`, `--text-*`, `--bg-*`, `--border-*`, etc.) and their Tailwind theme bridges. Never use raw Tailwind color utilities like `bg-blue-500`, `text-purple-600`, etc. — use the design system variables or pre-built pill classes (`.pill-blue`, `.pill-purple`, `.pill-green`, `.pill-red`, `.pill-amber`) instead.
  - **A utility only exists if `@theme inline` declares its `--color-*`.** Tailwind v4 emits nothing for a class whose token is absent, so the class silently does nothing rather than failing — `text-primary-foreground` sat in nine files that way. When you reach for a semantic surface, check the bridge block first.
  - **`bg-primary` is near-WHITE in dark mode.** `--color-primary` is `var(--accent)`, and `--accent` is `#171717` in light but `#f5f5f5` in dark. Text on it must be `text-primary-foreground` — never a hardcoded `text-white`. Any `--color-X`/`--color-X-foreground` pair must be redefined in **all three** theme blocks (`:root/.light`, `.dark`, and the `prefers-color-scheme` media query), because a foreground that does not flip renders white-on-white. `tests/app/globals.test.ts` enforces both halves of this — the contrast ratio and the token's existence.
- **Folder structure & modularity (strictly enforced):**
  - Follow existing folder structure. Never create new folders unless absolutely required.
  - Before creating a component, check if a reusable one already exists in `components/`. If it does, use it. Only create new ones when nothing fits.
  - Components live in `components/`, API routes in `app/api/`, services in `lib/`, constants in `constants/`, types in `lib/types.ts`. Enforce this separation at all times.
  - Page files (`app/(main)/*/page.tsx`, `app/(forms)/*/page.tsx`) must only import and compose — never define components inline. Extract all components to `components/`.
  - Always clean up unused code: dead imports, unused variables, stale functions, orphaned files. Do this proactively on every change — even if the mess predates your edit, fix it immediately.
  - If you encounter any violation of the above (inline component in a page, misplaced file, unused import, etc.), correct it on the spot regardless of whether it was part of the original task.
