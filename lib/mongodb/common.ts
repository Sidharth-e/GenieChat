import type { Filter } from "mongodb";
import {
  Thread,
  Message,
  Agent,
  Prompt,
  MCPServerConfig,
  WorkflowExecution,
  CustomTool,
  ToolSecret,
  Reminder,
  Bookmark,
  DeepResearchReport,
  ArenaLeaderboardEntry,
  ApiKey,
  RichWorkflow,
  AiUsage,
  Webhook,
  WebhookInvocation,
  Schedule,
  ScheduleRun,
} from "../types";
import { Role } from "../rbac/types";
import type { ArtifactType } from "../artifacts/types";
import type { KnowledgeHit } from "../knowledge/types";

/** A stored document: the app-level shape plus Mongo's mandatory `_id`. */
export type WithMongoId<T> = T & { _id: string };

/**
 * Guards against passing a type that already carries `_id` (e.g. `UserDocument`).
 * Such a type is never read through `hydrateDocument`, and because hydrating
 * deletes `_id` while its return type still promises it, the unsound call would
 * read `undefined` with no type error. Resolves to `never` for those types,
 * making the call site fail to compile; `unknown` (a no-op intersection)
 * everywhere else.
 */
type LacksMongoId<T> = "_id" extends keyof T ? never : unknown;

/**
 * The single read choke point. Renames `_id` to `id` so `lib/types.ts`
 * (which declares `id: string`) stays authoritative, and drops `_id` so it
 * never leaks into API responses.
 */
export function hydrateDocument<T>(doc: WithMongoId<T & LacksMongoId<T>>): T {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id } as T;
}

/**
 * Deletes every key whose value is exactly `undefined`, in place.
 *
 * A partial update is built as `{ ...stored, ...updates }` and written back
 * with `replaceOne`, so an `undefined` in `updates` is not "leave this field
 * alone": it is an own key that displaces the stored value, and the driver
 * stores it as `null` rather than dropping it. A caller that sends only the
 * fields it means to change — a rename, or a later client sending `{ trigger }`
 * alone — would otherwise erase every field it did not mention: a `null` trigger
 * stops a scheduled workflow being scheduled and drops a webhook's secret. The
 * same applies on insert, where an omitted optional field would be stored as
 * `null` in a document whose absent-key shape is what the readers test for.
 *
 * `null` is kept deliberately. It is a value a caller chose to send, not a
 * missing field. Only exact `undefined` is a hole.
 *
 * Lives here rather than in the store that first needed it, because every store
 * that builds a partial update needs the same rule and a store importing it from
 * a sibling store would be a dependency between two features that share nothing.
 */
export function dropUndefinedFields<T extends object>(doc: T): T {
  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return doc;
}

/**
 * Escape a user-supplied string so it can be used as a literal inside a
 * RegExp. Cosmos `CONTAINS` matched literally; `$regex` does not, so
 * unescaped input like "a+b" would match the wrong thing or throw.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive substring match across several fields — the Mongo
 * equivalent of `CONTAINS(LOWER(c.a), q) OR CONTAINS(LOWER(c.b), q)`.
 */
export function buildSearchFilter(
  term: string,
  fields: string[],
): Filter<Record<string, unknown>> {
  const pattern = new RegExp(escapeRegex(term), "i");
  return {
    $or: fields.map((field) => ({ [field]: pattern })),
  } as Filter<Record<string, unknown>>;
}

// --- Document types (Cosmos metadata removed) ---

export interface ThreadDocument extends Thread {
  type: "thread";
}

export interface MessageDocument extends Message {
  type: "message";
}

export interface AgentDocument extends Omit<Agent, "type"> {
  type: "agent";
}

export interface PromptDocument extends Prompt {
  type: "prompt";
  favoriteUserIds?: string[];
}

export interface MCPServerDocument extends MCPServerConfig {
  type: "mcp_server";
}

export interface RichWorkflowDocument extends RichWorkflow {
  type: "rich_workflow";
}

export interface WorkflowExecutionDocument extends WorkflowExecution {
  type: "execution";
}

export interface CustomToolDocument extends CustomTool {
  type: "custom_tool";
}

export interface ToolSecretDocument extends ToolSecret {
  type: "tool_secret";
}

export interface ReminderDocument extends Reminder {
  type: "reminder";
}

export interface BookmarkDocument extends Bookmark {
  type: "bookmark";
}

export interface DeepResearchReportDocument extends DeepResearchReport {
  type: "deep_research_report";
}

export interface ApiKeyDocument extends ApiKey {
  type: "api_key";
}

export interface AiUsageDocument extends AiUsage {
  type: "ai_usage";
}

export interface WebhookDocument extends Webhook {
  type: "webhook";
}

/**
 * The two scheduling collections each hold exactly one document shape, and
 * neither store writes nor queries a `type` discriminator — unlike `threads`
 * and `webhooks`, whose stores do both. Declaring one here would name a field
 * that is never stored and that no index or query filters on. A type alias
 * rather than an empty `interface extends`, because the rule that would flag
 * the latter (`no-empty-object-type`) is right that they are the same type.
 */
export type ScheduleDocument = Schedule;
export type ScheduleRunDocument = ScheduleRun;

export interface WebhookInvocationDocument extends WebhookInvocation {
  type: "webhook_invocation";
  /** Replaces Cosmos's per-document `ttl`. Indexed with expireAfterSeconds: 0. */
  expiresAt: Date;
}

export interface UserDocument {
  _id: string;
  userId: string;
  email: string;
  name: string;
  image?: string | null;
  role: Role;
  type: "user";
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
}

// --- Documents with no parent in `lib/types.ts` ---
//
// Ported the same way as the block above, but whole: the Cosmos store's local
// document shape is copied verbatim (still without `_id`, which the accessor's
// `WithMongoId` supplies) because there is no `lib/types.ts` interface to extend.

export interface NotesDocument {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: "workspace_note";
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactDocument {
  id: string;
  userId: string;
  /** The artifact kind, not a collection discriminator — same as the Cosmos doc. */
  type: ArtifactType;
  title: string;
  url: string;
  metadata?: Record<string, unknown>;
  chatId?: string;
  createdAt: string;
}

export interface AutoTaskDocument {
  id: string;
  userId: string;
  task: string;
  status: AutoTaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  type: "auto_task";
}

export type AutoTaskStatus = "pending" | "running" | "completed" | "failed";

/**
 * The `config` collection is mixed-type: announcement state and arena
 * leaderboard documents share it, discriminated by `type`. This is a base
 * interface rather than a union of the two shapes because the driver's
 * `replaceOne` replacement parameter is `WithoutId<T>` — i.e. `Omit<T, "_id">` —
 * and `Omit` over a union collapses to the members' *shared* keys, so an
 * announcement upsert would fail its excess-property check. Carrying the fields
 * the queries touch keeps both the announcement and the arena read/write paths
 * compiling with no narrowing step.
 *
 * No index signature: it would make `LacksMongoId` resolve to `never` and break
 * every `hydrateDocument` call on this collection.
 */
export interface ConfigDocument {
  id: string;
  userId: string;
  type: string;
  updatedAt: string;
  /** Absent on arena leaderboard documents. */
  createdAt?: string;
  /** `announcement_state` documents. */
  seenAnnouncementIds?: string[];
  /** `arena_leaderboard` documents. */
  entries?: Record<string, ArenaLeaderboardEntry>;
}

/**
 * The `logs` collection. Unlike the other document shapes here there is no
 * Cosmos document shape to port: `getLogContainer()` has no caller and nothing
 * in either data layer reads or writes this collection. Declared as the minimum
 * a user-scoped document here carries so the accessor is usable; give it real
 * fields when a log store actually lands.
 */
export interface LogDocument {
  id: string;
  userId: string;
  type: string;
  createdAt: string;
}

/**
 * The `CHAT_DOCUMENT` documents in the `documents` collection, ported from
 * `ChatDocumentModel` in `lib/knowledge/types.ts`.
 */
export interface ChatDocument {
  id: string;
  userId: string;
  chatThreadId: string;
  /** A real `Date`, as in the Cosmos model — these are never API responses. */
  createdAt: Date;
  /** `CHAT_DOCUMENT`. Left as `string` to match `ChatDocumentModel`. */
  type: string;
  isDeleted: boolean;
  name: string;
  content?: string;
  promptTokens?: number;
  totalPages?: number;
  numberOfIndexes?: number;
  uploadTime?: number;
  agentId?: string;
}

/**
 * The `CHAT_CITATION` documents in the `history` collection, ported from
 * `ChatCitationModel` in `lib/knowledge/types.ts`. The `history`
 * collection is mixed-type (`message` / `CHAT_CITATION` / `ai_usage`) and each
 * shape has its own accessor — see `client.ts`.
 */
export interface ChatCitationDocument {
  id: string;
  userId: string;
  chatThreadId: string;
  /** A real `Date`, as in the Cosmos model — these are never API responses. */
  createdAt: Date;
  /** `CHAT_CITATION`. Left as `string` to match `ChatCitationModel`. */
  type: string;
  content: KnowledgeHit;
}
