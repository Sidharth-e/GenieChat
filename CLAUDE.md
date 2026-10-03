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
pnpm memory:check     # Exercises the memory graph: writes, recall, delete, enrichment
pnpm memory:enrich    # Re-runs enrichment for memories left pending (honours ENRICH_LIMIT)
pnpm memory:migrate   # One-off: moves the `memories` collection into the Neo4j graph
pnpm schedules:check  # Exercises the scheduling concurrency properties: claim race, lease reaper, retry exhaustion, overlap
pnpm schedules:migrate # One-off: converts legacy workflow cron triggers into `schedules`
pnpm storage:check    # Exercises the Garage S3 client: put, presign, fetch, delete, NOT_FOUND
```

Package manager is **pnpm** (v11.1.2, `node-linker=hoisted`). Node >= 20 required.

`tsx` is the standalone Node runner for scripts that must run outside the Next.js build and the Vitest test environment — `scripts/setup-mongodb.ts` is such a script: a dev/ops bootstrap rather than application code.

## Architecture

### Route Groups (App Router)

- `app/(main)/` — authenticated pages: chat, agent-chat, multi-agent-chat, swarm-chat, auto, agents, tools, MCP, webhooks, artifacts, memories, workflow, workspace, admin, settings
- `app/(forms)/` — form-based CRUD pages: agents, tools, MCP, webhooks, workflow (separate layout, no chat sidebar)
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
- `lib/neo4j/` — the Neo4j driver. `config.ts` reads `config.neo4j` and is pure, returning null unless the URI *and* a password are present; `client.ts` is the `"server-only"` layer holding one lazily-built `Driver` plus `isNeo4jConfigured()`, so every caller degrades rather than throws.
- `lib/memory/` — the memory graph, and the only memory store. `graph-store.ts` is the `"server-only"` `MemoryGraphStore`; `cypher.ts` holds every statement, out of the store so `scripts/check-memory.ts` can run the same SQL the store does; `extract.ts`, `recall.ts`, `text.ts` and `update.ts` are pure and unit-tested; `enrichment-schema.ts` and `llm-extraction.ts` hold the model contract and the call, and `enrichment-write.ts` and `enrich.ts` write what it returns. `graph-view.ts` assembles the four graph reads into the drawn node/edge set and `graph-layout.ts` positions it — both pure and unit-tested, and both deliberately unaware of React Flow, so the decisions worth testing (which entities survive the cap, what an edge is called, what "degree" means, where a node lands) need no browser. `constants/memory.ts` holds the edge types, weights and limits. See [Memory Graph (Neo4j)](#memory-graph-neo4j) and [Memory Graph View](#memory-graph-view).
- `lib/schedules/` — the scheduling subsystem. `cadence.ts` (cron and `once` next-occurrence), `retry.ts` (backoff, terminal error classes, the reaper's outcome and `isRunOpen`), `schedule-input.ts` (draft and patch parsing, and the next-run-after-patch rule), `input-form.ts` (a Zod schema into form fields, and the string-to-value coercer) and `input-schemas.ts` (the per-target input schemas) are pure and unit-tested. `registry.ts` holds the `TriggerExecutor` map every target kind registers into and registers nothing itself; `executors.ts` performs the executor imports and re-exports the registry, and is the module request-time consumers import from — importing `getExecutor` from `registry.ts` instead yields an empty registry that answers `invalid_target` for every target while the type-check and the unit suite stay green. `executor-workflow.ts` and `executor-agent.ts` are the two registered executors (`tool` is deliberately absent); `run-agent.ts` is the headless agent run the `agent` executor and the webhook service share; `dispatch.ts` runs one named run; `tick.ts` is the I/O layer that runs one pass. `lib/api/cron-guard.ts` is the `CRON_SECRET` bearer check the tick and the dispatch seam share. Execution is **at-least-once**: a claimed run holds a lease, and a run whose process died is handed back by the reaper rather than being lost. `constants/schedules.ts` holds the lease length, the retry curve and the tick's bounds. See [Scheduling](#scheduling).
- `lib/api/` — helpers for the route layer. `rate-limit.ts` (see [Redis](#redis)), `agent-api-auth.ts` (the API-key path), `cron-guard.ts` (the `CRON_SECRET` bearer check the tick and the dispatch seam share), and `query-params.ts`, whose `boundedInt` clamps a query integer. It takes a `min` because `Number(null)` is `0` and a Mongo `.limit(0)` means *no limit* — without a lower bound an absent `?limit` returns the whole collection rather than a page.
- `lib/redis-client.ts` — Shared ioredis connections, one per named consumer, with a per-consumer circuit breaker. `getRedisClient(name, options)` returns a discriminated result (`ready` / `unconfigured` / `circuit-open`) so each caller picks its own degradation policy. See [Redis](#redis).
- `lib/mongodb/` — MongoDB data layer using the official `mongodb` driver. `client.ts` provides synchronous collection accessors that connect lazily on first use. Most `*-store.ts` files hold exactly one document shape, but some span more — `workflow-store.ts` spans workflows, rich workflows and executions — and one collection can back several stores — `tools` backs `tool-store.ts`, `secret-store.ts` and `api-key-store.ts`.
- `lib/langchain/` — LLM orchestration layer:
  - `model-factory.ts` — creates LangChain `BaseChatModel` instances from model IDs. Central place for all provider wiring (Google and Ollama only — the `ProviderKey` union in `lib/types.ts` is the source of truth).
  - `model-config.ts` — `AVAILABLE_MODELS` array defining all supported models and their capabilities, plus `DEFAULT_MODEL_ID` used wherever a caller has no model of its own.
  - `chat-service.ts` — single-agent streaming chat.
  - `agent-service.ts` — agent-based chat with tools.
  - `multi-agent-service.ts` — multi-agent orchestration (LangGraph supervisor).
  - `workflow-execution-service.ts` — runs automated workflow steps.
- `lib/auth/` — NextAuth.js config with the GitHub provider, role resolution from the `GITHUB_*_USERNAMES` allowlists (`role-resolution.ts`), and no token refresh — the session carries no provider tokens.
- `lib/tool/` — Tool system: `default-tools.ts` (built-in tools), `custom-tool-converter.ts` (user-defined tools).
- `lib/stores/` — Zustand client-side stores (agents, threads, chat settings, sidebar, workflows, etc.).
- `lib/ai-actions/` — Server actions for agents, prompts, and tools.
- `lib/artifacts/` — the Artifacts store's writers. `save.ts` holds `saveToolArtifact`, which every type but one reaches through a tool-result envelope; `scancode.ts` is the exception, saving from the message text instead. See [Scan Codes (```scancode)](#scan-codes-scancode).
- `lib/conversation.ts` — pure helpers shared by the four conversation surfaces: last-assistant detection, the standalone loading-message builder and its predicate. Unit-tested; see [Conversation Surfaces](#conversation-surfaces).

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

### Authentication Flow

Middleware in `proxy.ts` (not `middleware.ts`) protects all routes except `/login`, `/api/auth`, `/api/agents/v1`, and static assets. GitHub OAuth with JWT strategy, 30-day sessions. There is no token refresh — a GitHub OAuth App token does not expire and issues no refresh token, so the session carries no provider tokens. Roles are resolved from the `GITHUB_ADMIN_USERNAMES` / `GITHUB_MANAGER_USERNAMES` / `GITHUB_VIEWER_USERNAMES` allowlists, with the role already stored on the user record taking precedence; an unlisted login falls back to the default role.

### Environment Variables

Required: `MONGODB_URI` (and optional `MONGODB_DB_NAME`, defaulting to `geniechat`). In production, also requires `NEXTAUTH_SECRET` (>= 32 chars), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SECRET_ENCRYPTION_KEY`, `CRON_SECRET`, `REDIS_URL`, `POSTGRES_URL`, `NEO4J_URI`, `NEO4J_PASSWORD`. Chat, embeddings and web search need `OLLAMA_API_KEY` (for Ollama Cloud) and `EXA_API_KEY`; `GOOGLE_API_KEY` enables the Gemini models. `GITHUB_ADMIN_USERNAMES`, `GITHUB_MANAGER_USERNAMES` and `GITHUB_VIEWER_USERNAMES` are optional — an unset allowlist grants nobody that role, and a role already stored on the user record still takes precedence. `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` configure object storage and are optional as well: `S3_PUBLIC_ENDPOINT` is a second endpoint because SigV4 signs the Host header, so a URL presigned against an internal service name fails in a browser that resolves that name differently, and `S3_REGION` must match Garage's `s3_region` or every signature fails validation. `DOCLING_SERVE_URL`, `DOCLING_SERVE_API_KEY` and `DOCLING_SERVE_TIMEOUT_MS` configure the document-parsing sidecar and are optional too — see [Document Parsing (Docling)](#document-parsing-docling). `NEO4J_URI` and `NEO4J_PASSWORD` are required in production and are how the memory graph is reached; a blank `NEO4J_URI` is treated as unconfigured, so memory degrades to nothing rather than to a failed call. `OPENROUTER_API_KEY` and `OPENROUTER_EMBEDDING_MODEL` back the embedding provider. All other vars are optional. See `lib/env.ts` for the full schema.

**When adding a new env var:** update all four — `lib/env.ts` (schema + `superRefine` if prod-required), its `buildPlaceholders` map if prod-required (otherwise `pnpm build` fails validation, since `next build` runs with `NODE_ENV=production`), `.env.example` (value + comment), and the deployment environment's configuration if prod-required.

### Redis

One `REDIS_URL` connection string feeds both Redis consumers — rate limiting (`lib/api/rate-limit.ts`) and deep-research checkpoint caching (`lib/mongodb/deep-research-store.ts`). Each gets its own named client from `lib/redis-client.ts`, because they want opposite failure behaviour: the rate limiter fails fast and rejects with a 503 when Redis is down, while the checkpoint cache fails soft to MongoDB. `RateLimitResult.storage` is the one field on either interface that no caller reads.

`docker compose up -d` starts a local Redis for development (`docker-compose.yml`, loopback-only, no password). Production must point `REDIS_URL` at a Redis the app can reach over the network — the app does not host one itself, so that means a managed service, a container, or a VM. TLS is selected by the `rediss://` scheme; credentials go in the URL's userinfo.

### Object Storage (Garage)

Chat attachments, generated images, agent documents and deep-research reports live in self-hosted Garage behind the S3 API. Documents store a canonical `s3://bucket/key` ref rather than a durable URL, and every read presigns a fresh URL from that ref — so a shared link expires (`STORAGE_TTL` in `constants/storage.ts`), and a rotated key invalidates every outstanding presigned URL while the stored reference itself stays intact. See [Server-Side Core](#server-side-core-lib) for the module layout.

`docker compose up -d` starts a single-node Garage alongside Redis (`docker-compose.yml`). The six buckets — `chat-documents`, `chat-images`, `reports`, `agent-documents`, `generated-images` and `artifacts` — are ensured and granted to the application key by `scripts/garage-bootstrap.sh`, run by the `garage-bootstrap` compose service; it is idempotent and verifies the grant count rather than trusting `bucket list`. **A running Garage does not pick up a bucket added to that list later** — the service only runs at `compose up` — so a bucket added since the last bootstrap has to be created by re-running the service, or every write to it fails with `NoSuchBucket`. Garage's S3 API port (3900) is bound to all interfaces because **the browser, not only the app, fetches presigned URLs**; the web UI and admin API stay loopback-only.

`garage.toml` ships a development-only fixed `rpc_secret`, and **any deployment beyond local development must generate its own** — the committed value is safe here only because the RPC port is unpublished locally. In production Garage must likewise be reachable by the **browser**, not only the Web App, for the same presigned-URL reason; `S3_PUBLIC_ENDPOINT` is how those two addresses are told apart.

### Knowledge RAG (Postgres + pgvector)

Agent- and chat-document retrieval runs on PostgreSQL with pgvector. One table, `knowledge_chunks`, is keyed by `(owner_type, owner_id)` where the owner is an agent or a chat thread; `user_id` is stamped on every row and `source_id` names the originating document, so deleting one uploaded document removes only its chunks.

Retrieval is one statement: a pgvector cosine branch and a Postgres full-text branch over the generated `content_tsv` column, `LEFT JOIN`ed back to the rows so either arm can contribute, then fused by `combineRrf` (`lib/knowledge/ranking.ts`). Fusion uses ranks, not scores, which is why a cosine distance and a `ts_rank_cd` never need normalising. The lexical branch uses `websearch_to_tsquery`, not `to_tsquery` — the query is user text, and `to_tsquery` raises a syntax error on `(` or `&`. Each branch carries an explicit `ORDER BY` above its `ROW_NUMBER()` window, because it is the `ORDER BY` that decides which rows the `LIMIT` keeps.

**`user_id` is the authorization boundary and the owner is not one.** An agent id is not a secret — the agent stream route hands the model whichever agent id the request named without checking that the caller owns it — so both branches of the search filter on `user_id`, and `searchKnowledge` takes a required `userId` for that reason.

Writes use **replace semantics**: `indexChunks` deletes and reinserts inside one transaction, so re-running a backfill or re-uploading a document cannot double rows. The delete is scoped by `source_id` when the caller names a document, because a chat thread's chunks are all of its documents' chunks — an owner-wide delete would make a thread's second upload wipe the first. A source-less call still clears the whole owner. A chunk whose embedding fails is stored with a null vector and stays reachable through full-text search; the query side mirrors that, degrading to the lexical arm alone when the query embedding fails — **but only for an outage**. A width mismatch throws instead (`isEmbeddingDimensionError`, `lib/embeddings/dimensions.ts`), on the grounds that a query vector which can never match the stored ones would present a broken index as a working one. Embedding happens before the transaction opens, not inside it: the delete holds row locks on the owner, and one HTTP round trip per chunk is a long time to hold them. That ordering also means a width mismatch throws before the delete, leaving the previous index intact rather than replacing it with vectorless rows.

Deleting a document deletes its chunks, and a stored object is no longer enough to remove a document: `DeleteChatDocument` clears the document row and the chunks together, scoped by `source_id` and by the owner tuple read from the document itself — an agent upload carries an `agentId` and no thread, so a hardcoded chat owner would find nothing and orphan the chunks. `app/api/agents/files/route.ts` calls it before pruning the agent's document list, and the outcome decides whether the entry stays: a genuine failure keeps the file listed so the retry is meaningful, while `NOT_FOUND` is success, because the file is attached whether or not its text could be parsed, the stored object is already gone by then, and retaining the entry would strand it with nothing left to clear.

`pnpm db:setup:pg` creates the schema and indexes. `pnpm knowledge:check` exercises the store end to end against a live database. `pnpm knowledge:backfill` re-chunks and re-embeds documents already in MongoDB.

### Memory Graph (Neo4j)

Memories are a graph in Neo4j and nowhere else. Two node labels carry everything:
`:Memory` and `:Entity`. Edges are
`ABOUT` (memory→entity, written synchronously from the content), `RELATES_TO`
(memory→memory, scored from content alone), and `SUPERSEDES`, `CONTRADICTS` and
`RELATION` (LLM-written).

**Tenant isolation is a `userId` property, checked inside the query.** Neo4j has
no collection scoping, so the boundary lives in the `MATCH` clauses: the seed `SEARCH` filters in-index
(`WHERE m.userId = $userId` inside the `SEARCH`, not after it — a post-filter
would let another tenant's nearer matches consume the top-K), and `EXPAND_CYPHER`
re-checks `userId` on every node and edge of every hop, so a shared `:Entity` can
never bridge two users. The in-index `WHERE` is a restricted subset — equality
and `AND` only; an `OR`, a `<>` or a string operator fails with error 22ND3.

A write does its deterministic work in one transaction: the `:Memory` node, an
`:Entity` per extracted name, the `ABOUT` edges, and `RELATES_TO` edges scored
against the newest `MEMORY_EDGE_CANDIDATE_LIMIT` neighbours. Enrichment is fired
**detached** and never awaited — `enrichMemory` cannot throw and never rejects,
because a model call must not decide whether a memory is saved. `enrichedAt` is
the sweep's marker, and `embedding IS NULL` marks a memory written during an
embedding outage; `pnpm memory:enrich` selects on `enrichedAt IS NULL OR
embedding IS NULL` and must clear **both**, or every run re-enriches at a model
call each. That is why it writes the memory's own vector in the same transaction
as the enrichment.

Recall is a vector seed plus a bounded traversal, ranked in TypeScript
(`lib/memory/recall.ts`): the seed's cosine score and the path weight, decayed
per hop, plus a recency bonus. Seeds are vector-only. No seeds, or any error, returns an **empty** result with
`mode:
"vector"`, never `slice(0, top)`, because the first `top` rows of a corpus are
not an answer to a question. An unconfigured or unreachable Neo4j is an error
for CRUD rather than a silent empty list: memories *are* the feature, so the
store being down has to surface as a failure.

Two structural notes. `lib/memory/cypher.ts` holds every
statement specifically so `scripts/check-memory.ts` can execute the same SQL the
store does — the store is `"server-only"`, a check script cannot import it, and a
script carrying its own copy would be verifying the copy. And the `"server-only"`
guard does not resolve under `tsx`, which is why `cypher.ts`, `llm-extraction.ts`
and `enrichment-write.ts` carry no guard and hold no connection, while the sweep
in `scripts/enrich-memories.ts` builds its own model and embedding clients and
shares only those modules. Cypher cannot parameterise a relationship type or a
variable-length bound, so `buildMemoryEdgeCypher` interpolates behind an allow-list
and `MEMORY_RECALL_HOPS` is verified as a positive integer at import.

`pnpm db:setup:neo4j` creates the constraints and vector indexes. `pnpm
memory:check` exercises the store against a live graph. `pnpm memory:migrate` is
a one-off importer for memories written before the graph existed.

### Memory Graph View

`/memories` has a List / Graph toggle. The graph is read through
`GET /api/memories/graph`, which is session-scoped like every other memory route,
and assembled by `buildMemoryGraphView` from `lib/memory/graph-view.ts`.

Four reads, not one, and the order matters: `GRAPH_MEMORIES_CYPHER` picks the
window — newest first, capped — and the other three are then scoped to that id
set, which is what makes the drawn edges exactly those whose endpoints are drawn.
A single pattern would return edges to memories the window excluded, and the view
could only drop them (making the picture disagree with the degrees it reports) or
draw an orphan. `GRAPH_MEMORY_COUNT_CYPHER` supplies the true total, because the
truncation notice cannot be inferred from "the read returned exactly the limit" —
that reports truncation for a user who has exactly that many memories.

Two ceilings, bounding different things. `MEMORY_GRAPH_MEMORY_LIMIT` (120) bounds
the read; `MEMORY_GRAPH_NODE_LIMIT` (150) bounds what is drawn, memories plus
entities, with entities ranked by how many kept memories link them so a cap drops
the least-connected rather than an arbitrary slice. The node cap is a wall-clock
bound rather than an aesthetic one: `layoutMemoryGraph` is O(n²) per iteration and
runs synchronously in the render, so raising it means moving the layout off the
render path first.

The layout is hand-rolled Fruchterman–Reingold, deterministic — no `Math.random`
anywhere, so a remount does not reshuffle the picture. Repulsion is `k²/d` and
attraction `d²/k` against the ideal spacing `k`, which is what makes the result
need no per-graph tuning; the two cross at `d = k`. `MEMORY_GRAPH_LAYOUT_CENTER_PULL`
must stay far below the repulsion at a typical distance or the graph collapses to
a point — that margin is why the value looks so small. `constants/memory.ts`
carries the reasoning for each number, and `MEMORY_GRAPH_MEMORY_NODE_SIZE` /
`MEMORY_GRAPH_ENTITY_NODE_SIZE` live there too because the simulation and the
renderer have to agree on them.

Identity is never colour-alone. Node kind is shape and size (a bordered card is a
memory, a pill is an entity); edge kind is line style, paired with a legend that
names each one, with `--red` reserved for the single semantically loaded kind
(CONTRADICTS). The hover card is also the accessibility fallback: it shows the
full memory text a clamped node cannot, and it is the only place an edge's
model-written `reason` is readable. `scripts/check-memory.ts` covers these four
statements, since the store is `"server-only"` and the script is the only thing
that executes the same Cypher.

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
  `getMCPServer(serverId)`, `deleteThread(threadId)` — and ownership for those is
  enforced by hand at the route, which makes that route check load-bearing rather
  than belt-and-braces. The memory store is the counter-example: `getMemory(id,
  userId)`, `updateMemory(id, userId)` and `deleteMemory(id, userId)` carry the
  boundary themselves — the graph is queried with the owner in the `MATCH` — so
  `app/api/memories/[id]/route.ts`'s `memory.userId !== user.id` is a second lock on
  a door the store already closed. Two nearby accessors are
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
