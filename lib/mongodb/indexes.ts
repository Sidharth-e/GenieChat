import type { CreateIndexesOptions } from "mongodb";

/**
 * The MongoDB collection names and index definitions for the migration, as
 * pure data.
 *
 * This module is deliberately free of any `@/lib/config` or `@/lib/env`
 * import. `lib/env.ts` parses the whole environment schema at first import and
 * throws when a required key is missing, and `lib/config.ts` opens with
 * `import "server-only"` -- a package Next.js aliases at build time and
 * `vitest.setup.ts` mocks, but one that does not exist for a plain Node
 * process. Importing either here would make `scripts/setup-mongodb.ts`
 * unrunnable under `tsx`, which is the one thing the script must do. The
 * collection names are therefore spelled out below and kept honest by
 * `tests/lib/mongodb/indexes.test.ts`, which asserts this list matches
 * `config.mongodb.collections` exactly.
 */

/**
 * Every collection in the database, keyed the same way
 * `config.mongodb.collections` keys them so the two can be compared by eye.
 */
const NAMES = {
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
  notes: "notes",
  users: "users",
  autoTasks: "auto_tasks",
  artifacts: "artifacts",
  webhooks: "webhooks",
  schedules: "schedules",
  scheduleRuns: "schedule_runs",
} as const;

/** All 19 collection names. Asserted against `config.mongodb.collections`. */
export const COLLECTION_NAMES: string[] = Object.values(NAMES);

export type IndexSpec = {
  collection: string;
  keys: Record<string, 1 | -1>;
  options?: CreateIndexesOptions;
  name: string;
};

/**
 * The subset of a live index record this module compares against a spec. The
 * driver's `IndexDescriptionInfo` satisfies it: `indexes()` returns more fields
 * than these, and those extras (`v`, `ns`, `background`, ...) are ignored on
 * purpose.
 *
 * `IndexSpec.options` is typed `CreateIndexesOptions`, which permits far more
 * than `describeIndexMismatch` reads. The comparator checks exactly three
 * dimensions: `unique`, `expireAfterSeconds` and `partialFilterExpression`.
 * Every other option -- `sparse`, `hidden`, `collation`, `wildcardProjection`,
 * `weights` and the rest -- is invisible to it, so a spec that declared one
 * would be reported "equivalent" against any live index and would silently
 * never converge. `collation` is the worst of those, because it changes
 * comparison semantics rather than just performance.
 *
 * This is a deliberate boundary rather than an oversight: those three are the
 * only dimensions this migration's specs use. **A spec declaring anything
 * else needs `describeIndexMismatch` extended first.** The test named
 * "declares no option the comparator cannot check" is what enforces that: it
 * fails on a new option key instead of letting it pass unmentioned.
 */
export type LiveIndex = {
  key?: Record<string, unknown>;
  unique?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
};

/** A shared marker for a value no branch could classify at all. */
const UNRENDERABLE = "<unrenderable>";

/** Marker for an own property whose getter threw when the walk read it. */
const UNREADABLE = Symbol("unreadable");

/** How many payload bytes render as hex before the rendering is elided. */
const MAX_HEX_BYTES = 16;

/**
 * A canonical string for a value whose object key order carries no meaning, so
 * two spellings of the same filter compare equal. Recursive, because a partial
 * filter can nest (`{ tags: { $all: ["a", "b"] } }` is the shape this guards
 * against).
 *
 * Keeping *distinct* values distinct is the property that matters -- reporting
 * two different filters as equivalent is the dangerous direction, because the
 * script would then print `index exists:` and leave a wrong index in place,
 * which is the outcome the comparator exists to prevent. `Object.entries()`
 * alone does not achieve that for three families of value:
 *
 * - A `Date` and a `RegExp` carry no own enumerable properties, so both
 *   canonicalize to `{}` -- identical strings for different values. `Date` is
 *   not hypothetical here: `expiresAt` is a real `Date` field in this schema
 *   (see the `WebhookInvocationDocument.expiresAt` note on the TTL index).
 * - `JSON.stringify` maps `NaN` and both infinities to `"null"`, colliding with
 *   a genuine `null`.
 * - A BSON class instance needs **both** its `_bsontype` tag and its payload,
 *   because neither alone is enough for the classes the driver ships. A payload
 *   walk alone tells `ObjectId` and `Decimal128` apart -- they do keep their
 *   data in own enumerable properties -- but `String()` is `"[object Object]"`
 *   for `Code`, `BSONRegExp` and `DBRef`, and for `Binary` it is a UTF-8 decode
 *   that maps every non-UTF-8 payload onto the same replacement characters and
 *   drops `sub_type` entirely. So a tag plus the string form alone collapses
 *   four shipped families: measured, `Code("a")` against `Code("b")`, two
 *   `BSONRegExp`s differing only in flags, two `DBRef`s, and `Binary(sub_type
 *   0)` against `Binary(sub_type 1)` all render identically. `MinKey` and
 *   `MaxKey` are the mirror image -- they have no payload worth reading and are
 *   told apart by the tag alone.
 *
 * A BSON value therefore renders as `BSON(<tag>[:<label>]:<payload>)`. The tag
 * is `_bsontype`; the label is a short printable `String()` where there is one
 * (for an `ObjectId` that is its hex, which is what a filter on one means); and
 * the payload is a walk of the instance's own enumerable properties, which is
 * where every shipped class actually keeps its data. **The label is decorative
 * and the payload carries the identity**, so a class with no meaningful
 * `String()` loses nothing by not having one. Buffers and typed arrays render
 * as a hex prefix rather than one property per byte, which is what stops a
 * `Binary` payload becoming a multi-megabyte operator-facing warning.
 *
 * Ordering follows what the value means: object keys are sorted at every level,
 * because key order in a filter carries none, while arrays keep their order,
 * because position in a filter array does.
 *
 * **Totality is a guarantee: no input makes this throw.** Every read of a
 * property the value controls happens inside a guard, and the recursion goes
 * through this function, so a hostile member costs its own entry rather than
 * the whole walk. `new Proxy(new Date(0), {})` (whose `getTime` throws "not a
 * Date object"), a `Date` subclass overriding `toISOString` to throw, a revoked
 * `Proxy` (whose `getPrototypeOf` throws, so even `instanceof` raises), and an
 * object with a throwing getter all render a marker instead of raising.
 *
 * Its limits, stated so they are not mistaken for more than they are: a value
 * no branch can classify renders one shared marker, so two *unrenderable*
 * values compare equal -- harmless, since neither can be meaningfully compared
 * anyway; and the byte cap bounds payload *width*, not object breadth, so an
 * object with very many own keys still renders every one.
 *
 * The payload is the instance's own enumerable state rather than a canonical
 * BSON encoding, so it includes driver-internal fields -- the four words of an
 * `ObjectId`, `Binary`'s `position`. That is sound here because each of those
 * fields is part of the value rather than incidental state: `position` delimits
 * a `Binary`'s content (`value()`, `toString()` and the serializer all read only
 * up to it), so two `Binary`s differing in it are different values, not one
 * value spelled twice. A `UUID` is a `Binary` of sub_type 4 and renders as one,
 * which is also correct -- it *is* the same BSON value.
 */
function canonicalize(value: unknown): string {
  try {
    return renderValue(value);
  } catch {
    // A backstop, not the mechanism: the branches below guard their own reads,
    // so reaching here means the value defeated classification entirely -- a
    // revoked Proxy, whose `getPrototypeOf` trap throws for `instanceof` too.
    return UNRENDERABLE;
  }
}

function renderValue(value: unknown): string {
  if (value === UNREADABLE) return "<unreadable>";
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  switch (typeof value) {
    case "number":
      // `String(-0)` is `"0"`, so `-0` and `0` collide here, and that is
      // correct rather than a gap: measured against a live server, MongoDB
      // treats them as one value (a query on either matches both documents, and
      // `distinct` returns one), so two filters that select the same documents
      // are the same filter.
      if (Number.isNaN(value)) return "NaN";
      if (value === Number.POSITIVE_INFINITY) return "Infinity";
      if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
      return String(value);
    case "bigint":
      return `${value.toString()}n`;
    case "undefined":
      return "undefined";
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return String(value);
    case "symbol":
    case "function":
      return String(value);
    default:
      break;
  }

  // The tag is checked first so a BSON value is never claimed by a later
  // branch: a class that also looks like a view or a Date still keeps its type.
  const bsonType = readBsonType(value);
  if (bsonType !== null) {
    const label = bsonLabel(value);
    const payload = renderObject(value);
    return `BSON(${bsonType}:${label === null ? "" : `${label}:`}${payload})`;
  }

  const bytes = asBytes(value);
  if (bytes !== null) return renderBytes(bytes);

  if (value instanceof Date) return renderDate(value);
  if (value instanceof RegExp) return renderRegExp(value);

  return renderObject(value);
}

/** `_bsontype` when the value carries one -- duck-typed, since the driver is
 * only a type import here and `instanceof` would need every class imported. */
function readBsonType(value: object): string | null {
  try {
    const tag = (value as { _bsontype?: unknown })._bsontype;
    return typeof tag === "string" ? tag : null;
  } catch {
    return null;
  }
}

/**
 * `String(value)` when it is short, printable and not the useless
 * `"[object Object]"`, else null. Decorative only -- the payload carries the
 * identity -- so a value that fails every test here simply renders without a
 * label. Printable means no control characters and no U+FFFD, which is what a
 * non-UTF-8 `Binary` decode produces and what would otherwise put raw bytes
 * into an operator-facing warning.
 */
function bsonLabel(value: object): string | null {
  const text = safeToString(value);
  if (text === "[object Object]" || text.length === 0 || text.length > 40) {
    return null;
  }
  return /[\u0000-\u001f\u007f-\u009f�]/.test(text) ? null : text;
}

/** The value's bytes when it is a Buffer, typed array, DataView or
 * `ArrayBuffer`, else null. Returns null rather than throwing on a detached
 * buffer or a Proxy that refuses the reads. */
function asBytes(value: object): Uint8Array | null {
  try {
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
  } catch {
    return null;
  }
  return null;
}

/**
 * A hex prefix plus, when the payload is longer than that prefix, its length
 * and a checksum over *every* byte. The checksum is what keeps two payloads
 * apart that share a prefix and a length, which a bare prefix would report as
 * equal -- so what is elided is the rendering, not the identity. It is 32 bits,
 * so two such payloads can still collide, at odds no operator will meet.
 */
function renderBytes(bytes: Uint8Array): string {
  const shown = Math.min(bytes.length, MAX_HEX_BYTES);
  let hex = "";
  for (let i = 0; i < shown; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  if (bytes.length <= MAX_HEX_BYTES) return `0x${hex}`;
  return `0x${hex}…${bytes.length}b/${hashBytes(bytes)}`;
}

/** FNV-1a over the whole payload. */
function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = Math.imul(hash ^ bytes[i], 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A `Date` as its instant, never as an epoch integer, so the warning is
 * readable. Both reads are guarded: `Date.prototype.getTime` is called
 * explicitly because a subclass can override the method and a Proxy reporting a
 * Date prototype has no `[[DateValue]]` slot, so its own `getTime` throws "this
 * is not a Date object"; and the instant is formatted through a fresh `Date`
 * so a subclass's `toISOString` override cannot throw either.
 */
function renderDate(value: object): string {
  try {
    const time = Date.prototype.getTime.call(value);
    return Number.isNaN(time) ? "Date(invalid)" : `Date(${new Date(time).toISOString()})`;
  } catch {
    return "Date(<unrenderable>)";
  }
}

/** A `RegExp` by source and flags, guarded for the same reason: a Proxy over
 * one has no `[[RegExpMatcher]]` slot and throws from the accessors. */
function renderRegExp(value: RegExp): string {
  try {
    return `RegExp(/${value.source}/${value.flags})`;
  } catch {
    return "RegExp(<unrenderable>)";
  }
}

/**
 * Own enumerable properties, keys sorted, each member read under its own guard
 * so one hostile getter costs one entry instead of the walk. A value that
 * refuses enumeration at all -- a revoked Proxy -- renders `<unwalkable>`,
 * deliberately distinct from a genuinely empty object's `{}`, since conflating
 * "nothing there" with "could not look" is the dangerous direction.
 */
function renderObject(value: object): string {
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return "<unwalkable>";
  }

  const pairs: [string, unknown][] = [];
  for (const key of keys) {
    let member: unknown = UNREADABLE;
    try {
      member = (value as Record<string, unknown>)[key];
    } catch {
      // Left as the marker.
    }
    pairs.push([key, member]);
  }

  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const entries = pairs.map(
    ([key, member]) => `${JSON.stringify(key)}:${canonicalize(member)}`,
  );
  return `{${entries.join(",")}}`;
}

/**
 * `String(value)` that cannot throw. Reached only for a BSON instance, whose
 * `toString` is not under this module's control.
 */
function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "<unprintable>";
  }
}

/**
 * Compare a live index against its declared spec. Returns a human-readable
 * description of the first difference, or null when they are equivalent.
 *
 * Never causes a drop: a mismatch is reported so a human can decide. That
 * matters because `Collection.indexExists` is name-only -- without this check a
 * re-run reports "index exists" for an index whose options have drifted (a TTL
 * of 3600 seconds where the spec says 0, say) and the declared state silently
 * never converges.
 *
 * Absent `unique` means false and absent `expireAfterSeconds` means "no TTL",
 * so `{}` and `{ unique: false }` are equivalent rather than a mismatch.
 * Keys are compared as ordered `[field, direction]` pairs, because Mongo
 * preserves definition order and direction is part of an index's identity:
 * `{ userId: 1 }` and `{ userId: -1 }` are different indexes. The partial
 * filter is compared order-insensitively, since key order there means nothing.
 */
export function describeIndexMismatch(
  live: LiveIndex,
  spec: IndexSpec,
): string | null {
  const liveKeys = Object.entries(live.key ?? {});
  const specKeys = Object.entries(spec.keys);

  if (liveKeys.length !== specKeys.length) {
    return `keys differ: expected ${formatKeys(specKeys)}, found ${formatKeys(liveKeys)}`;
  }
  for (let i = 0; i < specKeys.length; i += 1) {
    const [specField, specDirection] = specKeys[i];
    const [liveField, liveDirection] = liveKeys[i];
    if (specField !== liveField || specDirection !== liveDirection) {
      return `keys differ: expected ${formatKeys(specKeys)}, found ${formatKeys(liveKeys)}`;
    }
  }

  const liveUnique = live.unique ?? false;
  const specUnique = spec.options?.unique ?? false;
  if (liveUnique !== specUnique) {
    return `unique differs: expected ${specUnique}, found ${liveUnique}`;
  }

  const liveTtl = live.expireAfterSeconds ?? null;
  const specTtl = spec.options?.expireAfterSeconds ?? null;
  if (liveTtl !== specTtl) {
    return `expireAfterSeconds differs: expected ${specTtl ?? "none"}, found ${liveTtl ?? "none"}`;
  }

  const liveFilter = canonicalize(live.partialFilterExpression ?? null);
  const specFilter = canonicalize(spec.options?.partialFilterExpression ?? null);
  if (liveFilter !== specFilter) {
    return `partialFilterExpression differs: expected ${specFilter}, found ${liveFilter}`;
  }

  return null;
}

/** Render key pairs the way the spec writes them, e.g. `{ userId: 1, createdAt: -1 }`. */
function formatKeys(entries: [string, unknown][]): string {
  return `{ ${entries.map(([field, direction]) => `${field}: ${String(direction)}`).join(", ")} }`;
}

/**
 * Every index the application relies on.
 *
 * Three classes of row live here, and the reasoning for each is worth keeping
 * next to the data:
 *
 * 1. **The five collections with hand-written, query-specific indexes** --
 *    `threads`, `history`, `documents`, `workflow_executions` and `webhooks`.
 *
 * 2. **The R64 user-scoped collections.** Cosmos's default indexing
 *    policy indexed every property, so every `ORDER BY` on a user listing was
 *    index-backed. MongoDB will only serve the sort from the index if the sort
 *    key is present, so the user-scoped listings carry `{ userId: 1, <sort key> }`
 *    and not a bare `{ userId: 1 }`. A compound index replaces the narrow one
 *    rather than joining it -- by the prefix rule it serves every query the
 *    narrow index served -- so the index count and write amplification are
 *    unchanged. Ascending and descending need no separate indexes: Mongo
 *    traverses an index in either direction, which is why `auto_tasks`'
 *    ascending `getPendingTask` shares the descending shape.
 *
 * 3. **Two queries that filter on something other than the partition key**
 *    (R62) and so could not use a `{ userId: 1 }` index at all:
 *    `tools.tools_keyhash` (the API-key auth path, reached on every
 *    API-key-authenticated request) and `users.users_listing` (the admin listing).
 *
 * One row deserves a note because it is weaker than the rule above:
 *
 * - `prompt.prompts_userId_updatedAt` backs `PromptStore.getPrompts`, which
 *   filters on `type` and `userId` and sorts newest-first. It is a strict
 *   superset of the `{ userId: 1 }` the table was already going to create, so it
 *   costs nothing.
 *
 * - `documents.documents_userId` is a bare `{ userId: 1 }`, the one deliberate
 *   exception. No user-scoped document listing exists or is planned: every
 *   `documents` read filters by `chatThreadId` (served by the other index) and
 *   `deleteDocument` leads with `_id`, so there is no sort for a second key to
 *   serve. Adding a timestamp key to match the R64 rows would index a field
 *   nothing orders by.
 */
export const INDEX_SPECS: IndexSpec[] = [
  // --- threads -------------------------------------------------------------
  // `getThreads` filters by user and sorts newest-first.
  {
    collection: NAMES.threads,
    keys: { userId: 1, lastMessageAt: -1 },
    name: "threads_userId_lastMessageAt",
  },
  // --- history -------------------------------------------------------------
  // The message list for a thread, in conversational order.
  {
    collection: NAMES.history,
    keys: { threadId: 1, createdAt: 1 },
    name: "history_threadId_createdAt",
  },
  // The ai-usage listing shares this collection and sorts newest-first.
  {
    collection: NAMES.history,
    keys: { userId: 1, type: 1, createdAt: -1 },
    name: "history_userId_type_createdAt",
  },

  // --- documents -----------------------------------------------------------
  // Serves the `documents` reads that filter on all three of `type`,
  // `chatThreadId` and `isDeleted`.
  {
    collection: NAMES.documents,
    keys: { type: 1, chatThreadId: 1, isDeleted: 1 },
    name: "documents_type_chatThreadId_isDeleted",
  },
  // Deliberately bare -- see the note in the doc comment above.
  {
    collection: NAMES.documents,
    keys: { userId: 1 },
    name: "documents_userId",
  },

  // --- workflow_executions -------------------------------------------------
  // `getExecutions` and `getLatestExecution` both filter by workflow and sort
  // newest-first.
  {
    collection: NAMES.workflowExecutions,
    keys: { workflowId: 1, createdAt: -1 },
    name: "workflowExecutions_workflowId_createdAt",
  },

  // --- webhooks ------------------------------------------------------------
  // The invocations listing. The trailing `triggeredAt` serves its sort.
  {
    collection: NAMES.webhooks,
    keys: { webhookId: 1, userId: 1, triggeredAt: -1 },
    name: "webhooks_invocations",
  },
  // The webhook listing itself (`WebhookStore.getByUserId`) -- a user-scoped
  // listing that the R64 table's first draft missed.
  {
    collection: NAMES.webhooks,
    keys: { userId: 1, createdAt: -1 },
    name: "webhooks_userId_createdAt",
  },
  // The one TTL index in the migration. `WebhookInvocationDocument.expiresAt`
  // is a real `Date`, as a TTL index requires one -- one of the three stored
  // real-`Date` fields, alongside `ChatDocument.createdAt` and
  // `ChatCitationDocument.createdAt` in `common.ts`. `expireAfterSeconds: 0`
  // expires each document at the instant `expiresAt` names.
  {
    collection: NAMES.webhooks,
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 },
    name: "webhooks_expiresAt_ttl",
  },

  // --- logs ----------------------------------------------------------------
  {
    collection: NAMES.logs,
    keys: { userId: 1, createdAt: -1 },
    name: "logs_userId_createdAt",
  },

  // --- the user-scoped collections (R64) -----------------------------------
  {
    collection: NAMES.agents,
    keys: { userId: 1, createdAt: -1 },
    name: "agents_userId_createdAt",
  },
  {
    collection: NAMES.prompts,
    keys: { userId: 1, updatedAt: -1 },
    name: "prompts_userId_updatedAt",
  },
  {
    collection: NAMES.mcpServers,
    keys: { userId: 1, updatedAt: -1 },
    name: "mcpServers_userId_updatedAt",
  },
  {
    collection: NAMES.tools,
    keys: { userId: 1, createdAt: -1 },
    name: "tools_userId_createdAt",
  },
  {
    collection: NAMES.notes,
    keys: { userId: 1, updatedAt: -1 },
    name: "notes_userId_updatedAt",
  },
  {
    collection: NAMES.artifacts,
    keys: { userId: 1, createdAt: -1 },
    name: "artifacts_userId_createdAt",
  },
  {
    collection: NAMES.autoTasks,
    keys: { userId: 1, createdAt: -1 },
    name: "autoTasks_userId_createdAt",
  },
  {
    collection: NAMES.workflows,
    keys: { userId: 1, createdAt: -1 },
    name: "workflows_userId_createdAt",
  },
  {
    collection: NAMES.deepResearch,
    keys: { userId: 1, createdAt: -1 },
    name: "deepResearch_userId_createdAt",
  },

  // --- the three R62 indexes: queries that cannot use `{ userId: 1 }` --------
  // `ApiKeyStore.findByHash` -- the API-key authentication path, reached on
  // every API-key-authenticated request. Without this, every authenticated agent
  // request becomes a full collection scan of the collection that holds every
  // tenant's tools, secrets and keys.
  {
    collection: NAMES.tools,
    keys: { keyHash: 1 },
    options: {
      partialFilterExpression: { type: "api_key", revoked: false },
    },
    name: "tools_keyhash",
  },
  // The admin user listing, `getAllUsers` -- unfiltered by user and unbounded,
  // which is why it sits behind an RBAC gate rather than a query constraint.
  // Nothing queries users by `userId` -- `_id` carries the id -- so this indexes
  // a query that exists rather than one that does not.
  {
    collection: NAMES.users,
    keys: { type: 1, lastLoginAt: -1 },
    name: "users_listing",
  },
  // The scheduler tick's due query, on every tick. Partial rather than leading
  // with `enabled`, matching `tools_keyhash`: a disabled schedule is never
  // looked up this way, so indexing it is dead weight.
  {
    collection: NAMES.schedules,
    keys: { nextRunAt: 1 },
    options: { partialFilterExpression: { enabled: true } },
    name: "schedules_due",
  },
  // The list page, which is scoped to one user and sorted newest-first.
  {
    collection: NAMES.schedules,
    keys: { userId: 1, updatedAt: -1 },
    name: "schedules_userId_updatedAt",
  },
  // Phase 4's claim (`status: "pending"` + `nextAttemptAt <= now`) and the
  // retry write, which are the same query.
  {
    collection: NAMES.scheduleRuns,
    keys: { status: 1, nextAttemptAt: 1 },
    name: "scheduleRuns_due",
  },
  // Phase 1's reaper, which looks for runs that went quiet.
  {
    collection: NAMES.scheduleRuns,
    keys: { status: 1, leaseExpiresAt: 1 },
    name: "scheduleRuns_lease",
  },
  // Per-schedule history, newest-first. `getRuns` sorts on `createdAt`, so a
  // `status` between the two keys would make the index unusable for that sort —
  // the sort keys have to be a suffix of the index keys, and a middle key breaks
  // the run. The overlap check before every insert (`scheduleId` + `status`) is
  // served by the `scheduleId` prefix, filtering `status` as a residual, which is
  // cheap because it only ever scans one schedule's runs.
  {
    collection: NAMES.scheduleRuns,
    keys: { scheduleId: 1, createdAt: -1 },
    name: "scheduleRuns_scheduleId_createdAt",
  },
  // Cross-schedule activity for one user.
  {
    collection: NAMES.scheduleRuns,
    keys: { userId: 1, createdAt: -1 },
    name: "scheduleRuns_userId_createdAt",
  },
  // Retention. `expireAfterSeconds: 0` means "expire at the stored instant",
  // which is why `expiresAt` is a real `Date` and not an ISO string — a string
  // field is not a `date` to the TTL monitor, so the index would never expire
  // anything.
  {
    collection: NAMES.scheduleRuns,
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 },
    name: "scheduleRuns_expiresAt_ttl",
  },
];
