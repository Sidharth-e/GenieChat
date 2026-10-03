import { describe, it, expect } from "vitest";
import {
  ObjectId,
  Decimal128,
  Long,
  Int32,
  Double,
  Timestamp,
  Binary,
  Code,
  BSONRegExp,
  DBRef,
  MinKey,
  MaxKey,
  BSONSymbol,
  UUID,
  type CreateIndexesOptions,
  type IndexDescriptionInfo,
} from "mongodb";
import {
  INDEX_SPECS,
  COLLECTION_NAMES,
  describeIndexMismatch,
  type IndexSpec,
} from "@/lib/mongodb/indexes";

// `@/lib/config` is imported for its collection names, and reaching it loads
// `lib/env.ts`, which parses `process.env` at first import and throws when the
// required key is missing. Vitest does not load `.env` into `process.env`, so
// the key is stubbed first; a real value already present is kept. The stub has
// to come *before* the import, which is why the config import below is a
// top-level `await import` rather than a static one -- a static import is
// hoisted above the assignment and would evaluate `lib/env.ts` too early.
// `user-store.test.ts` guards the same dependency the same way.
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

const { config } = await import("@/lib/config");

describe("COLLECTION_NAMES", () => {
  it("covers all 19 collections", () => {
    expect(COLLECTION_NAMES).toHaveLength(19);
  });

  it("matches the config collection names exactly", () => {
    expect(new Set(COLLECTION_NAMES)).toEqual(
      new Set(Object.values(config.mongodb.collections)),
    );
  });

  it("has no duplicates", () => {
    expect(new Set(COLLECTION_NAMES).size).toBe(COLLECTION_NAMES.length);
  });
});

describe("INDEX_SPECS", () => {
  it("only references known collections", () => {
    for (const spec of INDEX_SPECS) {
      expect(COLLECTION_NAMES).toContain(spec.collection);
    }
  });

  it("gives every index a unique name within its collection", () => {
    const seen = new Set<string>();
    for (const spec of INDEX_SPECS) {
      const key = `${spec.collection}:${spec.name}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("pins every spec by name, with their collection, keys and options", () => {
    // The whole file pinned by one assertion, replacing the per-row tests this
    // suite used to carry. That replacement is the point rather than tidying.
    // Each earlier version pinned a subset -- five rows, then twelve, then
    // twelve plus two -- and each review round found the rows just outside it:
    // `webhooks_invocations`, the invocations listing, was matched by no test at
    // all until this one, and the six rows the last review named were the
    // residual of that pattern rather than its extent. A name → spec map has no
    // "just outside": a spec added, removed or altered anywhere in INDEX_SPECS
    // lands here as a diff.
    //
    // So this is the file's documentation as well as its guard. Each row says
    // which query the index serves and why its keys are what they are; that
    // reasoning used to be spread across fourteen tests, which is part of how
    // the gaps went unnoticed.
    //
    // `toEqual`, not `toStrictEqual`: an absent `options` and an
    // `options: undefined` are the same thing here, which is what lets a row
    // with no options read as `{ collection, keys }` alone.
    const expected: Record<
      string,
      {
        collection: string;
        keys: Record<string, 1 | -1>;
        options?: CreateIndexesOptions;
      }
    > = {
      // --- the collections with hand-written, query-specific indexes --------
      // `getThreads` filters by user and sorts newest-first.
      threads_userId_lastMessageAt: {
        collection: config.mongodb.collections.threads,
        keys: { userId: 1, lastMessageAt: -1 },
      },
      // Public share pages look a thread up by `shareId` and require
      // `isShared: true`, so the partial filter covers every document that
      // lookup can return.
      threads_shareId: {
        collection: config.mongodb.collections.threads,
        keys: { shareId: 1 },
        options: { partialFilterExpression: { isShared: true } },
      },
      // The message list for a thread, in conversational order.
      history_threadId_createdAt: {
        collection: config.mongodb.collections.history,
        keys: { threadId: 1, createdAt: 1 },
      },
      // The ai-usage listing shares this collection and sorts newest-first.
      history_userId_type_createdAt: {
        collection: config.mongodb.collections.history,
        keys: { userId: 1, type: 1, createdAt: -1 },
      },
      // Serves the `documents` reads that filter on all three of `type`,
      // `chatThreadId` and `isDeleted`.
      documents_type_chatThreadId_isDeleted: {
        collection: config.mongodb.collections.documents,
        keys: { type: 1, chatThreadId: 1, isDeleted: 1 },
      },
      // Deliberately bare, and the only spec that is. No user-scoped document
      // listing exists or is planned: every `documents` read filters by
      // `chatThreadId` (served above) and `deleteDocument` leads with `_id`, so
      // there is no sort for a second key to serve, and adding a timestamp key
      // to match the R64 rows would index a field nothing orders by.
      documents_userId: {
        collection: config.mongodb.collections.documents,
        keys: { userId: 1 },
      },
      // `getExecutions` and `getLatestExecution` both filter by workflow and
      // sort newest-first.
      workflowExecutions_workflowId_createdAt: {
        collection: config.mongodb.collections.workflowExecutions,
        keys: { workflowId: 1, createdAt: -1 },
      },
      // The invocations listing. The trailing `triggeredAt` serves its sort,
      // and its presence is why this spec is found by name: `webhooks` holds
      // three specs and one other also bears `userId`.
      webhooks_invocations: {
        collection: config.mongodb.collections.webhooks,
        keys: { webhookId: 1, userId: 1, triggeredAt: -1 },
      },
      // The webhook listing itself (`WebhookStore.getByUserId`).
      webhooks_userId_createdAt: {
        collection: config.mongodb.collections.webhooks,
        keys: { userId: 1, createdAt: -1 },
      },
      // The one TTL index in the migration.
      // `WebhookInvocationDocument.expiresAt` is a real `Date`, as a TTL index
      // requires one -- one of the three stored real-`Date` fields, alongside
      // `ChatDocument.createdAt` and `ChatCitationDocument.createdAt` in
      // `common.ts`; `expireAfterSeconds: 0` expires each document at the
      // instant `expiresAt` names.
      webhooks_expiresAt_ttl: {
        collection: config.mongodb.collections.webhooks,
        keys: { expiresAt: 1 },
        options: { expireAfterSeconds: 0 },
      },
      logs_userId_createdAt: {
        collection: config.mongodb.collections.logs,
        keys: { userId: 1, createdAt: -1 },
      },

      // --- the user-scoped collections (R64) --------------------------------
      // Cosmos's default indexing policy indexed every property, so every
      // `ORDER BY` on a user listing was index-backed. MongoDB serves the sort
      // only when the sort key is in the index, so each of these carries
      // `{ userId: 1, <sort key> }` rather than the bare `{ userId: 1 }` the
      // migration table first prescribed. Ascending and descending need no
      // separate indexes -- Mongo traverses an index in either direction --
      // which is why `auto_tasks`' ascending `getPendingTask` shares the
      // descending shape below.
      agents_userId_createdAt: {
        collection: config.mongodb.collections.agents,
        keys: { userId: 1, createdAt: -1 },
      },
      prompts_userId_updatedAt: {
        // Serves only the first branch of `PromptStore.getPrompts`' three-branch
        // `$or`. The other two are public and explicitly-shared prompts, which
        // by definition are not the caller's own, so no `userId`-prefixed index
        // can serve them. Built anyway: it is a strict superset of the
        // `{ userId: 1 }` the table was already going to create, so it costs
        // nothing. A `{ type: 1, updatedAt: -1 }` index would serve the leading
        // equality across all three branches, but that is an *additional* index
        // and therefore an R62-class argument this task does not make.
        collection: config.mongodb.collections.prompts,
        keys: { userId: 1, updatedAt: -1 },
      },
      mcpServers_userId_updatedAt: {
        collection: config.mongodb.collections.mcpServers,
        keys: { userId: 1, updatedAt: -1 },
      },
      tools_userId_createdAt: {
        collection: config.mongodb.collections.tools,
        keys: { userId: 1, createdAt: -1 },
      },
      notes_userId_updatedAt: {
        collection: config.mongodb.collections.notes,
        keys: { userId: 1, updatedAt: -1 },
      },
      artifacts_userId_createdAt: {
        collection: config.mongodb.collections.artifacts,
        keys: { userId: 1, createdAt: -1 },
      },
      autoTasks_userId_createdAt: {
        collection: config.mongodb.collections.autoTasks,
        keys: { userId: 1, createdAt: -1 },
      },
      workflows_userId_createdAt: {
        collection: config.mongodb.collections.workflows,
        keys: { userId: 1, createdAt: -1 },
      },
      deepResearch_userId_createdAt: {
        collection: config.mongodb.collections.deepResearch,
        keys: { userId: 1, createdAt: -1 },
      },

      // --- the three R62 indexes: queries that cannot use `{ userId: 1 }` ----
      // `ApiKeyStore.findByHash` -- the API-key authentication path, reached on
      // every API-key-authenticated request. Without this index every
      // authenticated agent request becomes a collection scan of the collection
      // that holds every tenant's tools, secrets and keys. It is the spec whose
      // deletion most needs a test to notice, which is why its `options` is
      // pinned whole and not just field by field.
      tools_keyhash: {
        collection: config.mongodb.collections.tools,
        keys: { keyHash: 1 },
        options: {
          partialFilterExpression: { type: "api_key", revoked: false },
        },
      },
      // The admin listing `getAllUsers`. Nothing queries users by `userId` --
      // `_id` carries the id -- so this indexes a query that exists rather than
      // one that does not. Its `options` being absent is the assertion that
      // matters: `unique: true` here would make the second user sharing a
      // `lastLoginAt` fail the user-store write, surfacing as real users unable
      // to log in.
      users_listing: {
        collection: config.mongodb.collections.users,
        keys: { type: 1, lastLoginAt: -1 },
      },
      // `PromptStore.getPromptByShareId`, the public share-link lookup. Mirrors
      // the identical query shape already indexed on `threads`.
      prompts_shareId: {
        collection: config.mongodb.collections.prompts,
        keys: { shareId: 1 },
        options: { partialFilterExpression: { isShared: true } },
      },
      // The scheduler tick's due query, on every tick. Partial rather than
      // leading with `enabled`, matching `tools_keyhash`: a disabled schedule is
      // never looked up this way.
      schedules_due: {
        collection: config.mongodb.collections.schedules,
        keys: { nextRunAt: 1 },
        options: { partialFilterExpression: { enabled: true } },
      },
      schedules_userId_updatedAt: {
        collection: config.mongodb.collections.schedules,
        keys: { userId: 1, updatedAt: -1 },
      },
      scheduleRuns_due: {
        collection: config.mongodb.collections.scheduleRuns,
        keys: { status: 1, nextAttemptAt: 1 },
      },
      scheduleRuns_lease: {
        collection: config.mongodb.collections.scheduleRuns,
        keys: { status: 1, leaseExpiresAt: 1 },
      },
      scheduleRuns_scheduleId_status_createdAt: {
        collection: config.mongodb.collections.scheduleRuns,
        keys: { scheduleId: 1, status: 1, createdAt: -1 },
      },
      scheduleRuns_userId_createdAt: {
        collection: config.mongodb.collections.scheduleRuns,
        keys: { userId: 1, createdAt: -1 },
      },
      // Retention. `expireAfterSeconds: 0` expires at the stored instant, which
      // is why `expiresAt` is a real `Date` and not an ISO string.
      scheduleRuns_expiresAt_ttl: {
        collection: config.mongodb.collections.scheduleRuns,
        keys: { expiresAt: 1 },
        options: { expireAfterSeconds: 0 },
      },
    };

    const actual = Object.fromEntries(
      INDEX_SPECS.map((spec) => [
        spec.name,
        { collection: spec.collection, keys: spec.keys, options: spec.options },
      ]),
    );
    expect(actual).toEqual(expected);

    // Asserted separately, because `Object.fromEntries` silently collapses a
    // duplicated name: without this, a spec sharing a name with an existing one
    // would leave both maps equal and the extra spec unpinned.
    expect(INDEX_SPECS).toHaveLength(Object.keys(expected).length);
  });

  it("declares no option the comparator cannot check", () => {
    // `IndexSpec.options` is a `CreateIndexesOptions`, which permits far more than
    // `describeIndexMismatch` reads: the comparator checks `unique`, `expireAfterSeconds`
    // and `partialFilterExpression`, and is blind to `sparse`, `hidden`, `collation`,
    // `wildcardProjection`, `weights` and the rest. A spec that gained one of those would be
    // reported "equivalent" against any live index and would silently never converge.
    //
    // No spec declares anything outside the three today, so this passes as written. It is a
    // boundary, not a discovery: its job is to fail on the next `sparse: true` and tell the
    // author to extend the comparator, rather than letting the option slip through
    // unmentioned.
    const COMPARED = new Set([
      "unique",
      "expireAfterSeconds",
      "partialFilterExpression",
    ]);

    const unchecked = INDEX_SPECS.flatMap((spec) =>
      Object.keys(spec.options ?? {})
        .filter((option) => !COMPARED.has(option))
        .map((option) => `${spec.name} declares "${option}"`),
    );

    expect(unchecked).toEqual([]);
  });

  it("has no two specs with an identical shape in the same collection", () => {
    // MongoDB does NOT treat two differently-named indexes with identical keys
    // and an identical filter as duplicates: it creates both, and every write
    // then maintains both. This is the hazard the plan's `prompt_shareid` name
    // created -- an operator applying both that name and the built
    // `prompts_shareId` would have produced exactly this duplicate. There is
    // none today; this test keeps one from being introduced later.
    const seen = new Set<string>();
    for (const spec of INDEX_SPECS) {
      const shape = [
        spec.collection,
        JSON.stringify(Object.entries(spec.keys)),
        JSON.stringify(
          Object.entries(spec.options?.partialFilterExpression ?? {}).sort(),
        ),
      ].join("|");
      expect(seen.has(shape)).toBe(false);
      seen.add(shape);
    }
  });
});

describe("describeIndexMismatch", () => {
  // A spec and a live index that agree, as the baseline every case varies from.
  const spec: IndexSpec = {
    collection: "webhooks",
    keys: { webhookId: 1, userId: 1, triggeredAt: -1 },
    name: "webhooks_invocations",
  };

  it("returns null for an equivalent index", () => {
    expect(
      describeIndexMismatch(
        { key: { webhookId: 1, userId: 1, triggeredAt: -1 } },
        spec,
      ),
    ).toBeNull();
  });

  it("returns null for a live index carrying extra driver fields", () => {
    // What `listIndexes` actually hands back: the declared keys plus `v`, `ns`
    // and friends. Only the four declarable things are ever compared.
    const live: IndexDescriptionInfo = {
      key: { webhookId: 1, userId: 1, triggeredAt: -1 },
      name: "webhooks_invocations",
      v: 2,
      ns: "geniechat.webhooks",
    };
    expect(describeIndexMismatch(live, spec)).toBeNull();
  });

  it("returns null when an absent unique is spelled out as false", () => {
    // Absent `unique` means false, so `{}` vs `{ unique: false }` is not a
    // mismatch -- otherwise every re-run would warn.
    expect(
      describeIndexMismatch(
        { key: { webhookId: 1, userId: 1, triggeredAt: -1 }, unique: false },
        spec,
      ),
    ).toBeNull();
  });

  it("reports a key in the wrong order", () => {
    const result = describeIndexMismatch(
      { key: { userId: 1, webhookId: 1, triggeredAt: -1 } },
      spec,
    );
    expect(result).toContain("keys differ");
  });

  it("reports a key pointing the wrong direction", () => {
    // Direction is part of an index's identity: `{ userId: 1 }` and
    // `{ userId: -1 }` are different indexes, not the same one traversed
    // backwards.
    const result = describeIndexMismatch(
      { key: { webhookId: 1, userId: 1, triggeredAt: 1 } },
      spec,
    );
    expect(result).toContain("keys differ");
  });

  it("reports a missing key", () => {
    const result = describeIndexMismatch(
      { key: { webhookId: 1, userId: 1 } },
      spec,
    );
    expect(result).toContain("keys differ");
  });

  it("reports a wrong expireAfterSeconds, and a missing TTL entirely", () => {
    const ttlSpec: IndexSpec = {
      collection: "webhooks",
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
      name: "webhooks_expiresAt_ttl",
    };

    // The exact drift M3 exists to catch: the right name, the wrong TTL.
    expect(
      describeIndexMismatch(
        { key: { expiresAt: 1 }, expireAfterSeconds: 3600 },
        ttlSpec,
      ),
    ).toContain("expireAfterSeconds differs");

    // An index that is not a TTL index at all against a spec that declares one.
    expect(
      describeIndexMismatch({ key: { expiresAt: 1 } }, ttlSpec),
    ).toContain("expireAfterSeconds differs");

    // And the reverse: a TTL index where the spec declares none.
    const plainSpec: IndexSpec = { ...spec };
    expect(
      describeIndexMismatch(
        { key: { webhookId: 1, userId: 1, triggeredAt: -1 }, expireAfterSeconds: 60 },
        plainSpec,
      ),
    ).toContain("expireAfterSeconds differs");
  });

  it("reports a spurious unique", () => {
    const result = describeIndexMismatch(
      { key: { webhookId: 1, userId: 1, triggeredAt: -1 }, unique: true },
      spec,
    );
    expect(result).toContain("unique differs");
  });

  it("reports an extra, missing or changed partial-filter field", () => {
    const filterSpec: IndexSpec = {
      collection: "tools",
      keys: { keyHash: 1 },
      options: {
        partialFilterExpression: { type: "api_key", revoked: false },
      },
      name: "tools_keyhash",
    };

    expect(
      describeIndexMismatch(
        {
          key: { keyHash: 1 },
          partialFilterExpression: {
            type: "api_key",
            revoked: false,
            extra: 1,
          },
        },
        filterSpec,
      ),
    ).toContain("partialFilterExpression differs");

    expect(
      describeIndexMismatch(
        { key: { keyHash: 1 }, partialFilterExpression: { type: "api_key" } },
        filterSpec,
      ),
    ).toContain("partialFilterExpression differs");

    expect(
      describeIndexMismatch(
        {
          key: { keyHash: 1 },
          partialFilterExpression: { type: "api_key", revoked: true },
        },
        filterSpec,
      ),
    ).toContain("partialFilterExpression differs");

    // A partial filter where the spec declares none, and vice versa.
    expect(
      describeIndexMismatch(
        { key: { keyHash: 1 }, partialFilterExpression: { type: "api_key" } },
        { collection: "tools", keys: { keyHash: 1 }, name: "plain" },
      ),
    ).toContain("partialFilterExpression differs");

    expect(
      describeIndexMismatch(
        { key: { keyHash: 1 } },
        filterSpec,
      ),
    ).toContain("partialFilterExpression differs");
  });

  it("compares the partial filter order-insensitively", () => {
    // Object key order in a filter carries no meaning, so the same filter
    // written the other way round must not read as drift.
    expect(
      describeIndexMismatch(
        {
          key: { keyHash: 1 },
          partialFilterExpression: { revoked: false, type: "api_key" },
        },
        {
          collection: "tools",
          keys: { keyHash: 1 },
          options: {
            partialFilterExpression: { type: "api_key", revoked: false },
          },
          name: "tools_keyhash",
        },
      ),
    ).toBeNull();
  });

  it("compares a nested filter order-insensitively at every level", () => {
    // The doc comment cites the nested shape as what the recursion guards
    // against, and until now the only order test used a flat filter. A
    // canonicalizer that sorted only the top level passes every other test in
    // this file while reporting two spellings of the same nested filter as
    // drift -- and false positives are not harmless here: they train an operator
    // to ignore a warning that is also the only signal of a genuinely wrong
    // index.
    const nestedSpec: IndexSpec = {
      collection: "prompt",
      keys: { shareId: 1 },
      options: {
        partialFilterExpression: {
          sharedWith: { $elemMatch: { id: "user-1", role: "editor" } },
        },
      },
      name: "prompts_shareId",
    };

    expect(
      describeIndexMismatch(
        {
          key: { shareId: 1 },
          partialFilterExpression: {
            sharedWith: { $elemMatch: { role: "editor", id: "user-1" } },
          },
        },
        nestedSpec,
      ),
    ).toBeNull();

    // Reordering must not mask a real difference one level down, or the test
    // above would pass on a canonicalizer that discarded nested values.
    expect(
      describeIndexMismatch(
        {
          key: { shareId: 1 },
          partialFilterExpression: {
            sharedWith: { $elemMatch: { role: "viewer", id: "user-1" } },
          },
        },
        nestedSpec,
      ),
    ).toContain("partialFilterExpression differs");
  });

  it("treats array order in a filter as meaningful", () => {
    // Object keys are sorted because their order carries no meaning; arrays are
    // deliberately left alone because theirs does. `$all: ["a", "b"]` and
    // `$all: ["b", "a"]` are two different filters as written, and the
    // comparator cannot know an operator's semantics well enough to call them
    // the same -- so it reports them as different rather than guessing they are
    // equal. Sorting arrays too would be a false negative in the dangerous
    // direction: `index exists:` printed over an index whose filter is not the
    // declared one.
    const arraySpec: IndexSpec = {
      collection: "prompt",
      keys: { shareId: 1 },
      options: { partialFilterExpression: { tags: { $all: ["a", "b"] } } },
      name: "prompts_shareId",
    };

    expect(
      describeIndexMismatch(
        { key: { shareId: 1 }, partialFilterExpression: { tags: { $all: ["b", "a"] } } },
        arraySpec,
      ),
    ).toContain("partialFilterExpression differs");

    // The same array in the same order is equivalent, so the case above is
    // reporting the order rather than reporting every array.
    expect(
      describeIndexMismatch(
        { key: { shareId: 1 }, partialFilterExpression: { tags: { $all: ["a", "b"] } } },
        arraySpec,
      ),
    ).toBeNull();
  });

  describe("values JSON cannot represent", () => {
    // `canonicalize` walks `Object.entries`, which is empty for a `Date` and a
    // `RegExp` -- so both collapsed to the same `{}` -- and `JSON.stringify`
    // mapped `NaN` and both infinities to `"null"`, colliding with a genuine
    // `null`. Two different filters therefore compared equal, the script printed
    // `index exists:` and warned nothing, and the wrong index survived silently
    // -- the exact outcome the comparator exists to prevent. Swapping the
    // pre-fix `canonicalize` back in fails six of the seven cases below; the
    // `ObjectId` case is the seventh and is discussed where it appears.
    //
    // Every case asserts both directions. A canonicalizer that returned a
    // constant string for these values would satisfy "two different values are a
    // mismatch" only by accident and would report a *correct* index as drifted;
    // asserting the equivalence as well is what pins the behaviour rather than
    // the failure.
    const T0 = new Date("2026-01-01T00:00:00.000Z");
    const T1 = new Date("2030-01-01T00:00:00.000Z");

    /** Compare a live filter against a declared one, keys agreeing throughout. */
    const compare = (
      found: Record<string, unknown>,
      declared: Record<string, unknown>,
    ) =>
      describeIndexMismatch(
        { key: { keyHash: 1 }, partialFilterExpression: found },
        {
          collection: "tools",
          keys: { keyHash: 1 },
          options: { partialFilterExpression: declared },
          name: "tools_keyhash",
        },
      );

    it("distinguishes Dates by instant, and matches equal instants", () => {
      // The reviewer's scenario, and not a hypothetical one for this schema:
      // `WebhookInvocationDocument.expiresAt` is a real `Date` --
      // one of the three stored real-`Date` fields, alongside
      // `ChatDocument.createdAt` and `ChatCitationDocument.createdAt` in
      // `common.ts` -- so a filter bounding it is a filter someone could write.
      expect(compare({ expiresAt: { $gt: T1 } }, { expiresAt: { $gt: T0 } })).toContain(
        "partialFilterExpression differs",
      );

      // A separately constructed date with the same time value is the same
      // instant, so this must not read as drift.
      expect(
        compare(
          { expiresAt: { $gt: new Date("2026-01-01T00:00:00.000Z") } },
          { expiresAt: { $gt: T0 } },
        ),
      ).toBeNull();
    });

    it("renders a Date in the warning as an instant, not a bare epoch number", () => {
      // `canonicalize`'s output is interpolated into the operator-facing
      // warning, so the rendering is part of the contract: `1704067200000` and
      // `1893456000000` do not tell a human which filter is which.
      const result = compare({ expiresAt: { $gt: T1 } }, { expiresAt: { $gt: T0 } });
      expect(result).toContain("2026-01-01T00:00:00.000Z");
      expect(result).toContain("2030-01-01T00:00:00.000Z");
    });

    it("does not throw on an invalid Date, and still tells it from a valid one", () => {
      // `new Date(NaN).toISOString()` throws, so an unguarded rendering would
      // make the function total only for the values people happen to write.
      expect(compare({ expiresAt: { $gt: new Date("nonsense") } }, { expiresAt: { $gt: T0 } })).toContain(
        "partialFilterExpression differs",
      );

      // There is one invalid instant, so two invalid Dates are the same value
      // and must not read as drift.
      expect(
        compare(
          { expiresAt: { $gt: new Date("nonsense") } },
          { expiresAt: { $gt: new Date("also nonsense") } },
        ),
      ).toBeNull();
    });

    it("keeps NaN, Infinity and null distinct", () => {
      expect(compare({ $gt: NaN }, { $gt: null })).toContain(
        "partialFilterExpression differs",
      );
      expect(compare({ $gt: Number.POSITIVE_INFINITY }, { $gt: null })).toContain(
        "partialFilterExpression differs",
      );
      expect(compare({ $gt: Number.NEGATIVE_INFINITY }, { $gt: Number.POSITIVE_INFINITY })).toContain(
        "partialFilterExpression differs",
      );
      expect(compare({ $gt: NaN }, { $gt: Number.POSITIVE_INFINITY })).toContain(
        "partialFilterExpression differs",
      );

      // Equal infinities are the same value, so this must not read as drift.
      expect(
        compare(
          { $gt: Number.POSITIVE_INFINITY },
          { $gt: Number.POSITIVE_INFINITY },
        ),
      ).toBeNull();
    });

    it("renders every BSON family distinctly, and equal instances identically", () => {
      // Every BSON class the driver ships, found by enumerating the module for
      // prototypes carrying `_bsontype` -- fourteen of them, with `UUID` being a
      // `Binary` of sub_type 4 rather than a class of its own.
      //
      // Both directions, for every family, because one direction alone is not
      // evidence. A renderer that collapsed two different values would fail the
      // first assertion; one that returned a fresh unique string per instance
      // -- the object's identity, say -- would fail the second. The pair is what
      // pins "distinct values differ, and only those".
      //
      // The families below are the ones an earlier version got wrong. It
      // rendered `BSON(<tag>:<String(value)>)`, and `String()` is
      // `"[object Object]"` for `Code`, `BSONRegExp` and `DBRef`, while for
      // `Binary` it is a UTF-8 decode that maps every non-UTF-8 payload onto the
      // same replacement characters and loses `sub_type`. So `Code("a")` and
      // `Code("b")`, two `BSONRegExp`s differing only in flags, two `DBRef`s,
      // and `Binary(sub 0)` against `Binary(sub 1)` all rendered identically --
      // the dangerous direction, in the round that existed to remove it. `Binary`
      // printable and `UUID` passed only by accident: their `String()` happens
      // to be injective. Hence the payload, which is what carries identity now,
      // with `String()` demoted to a decorative label.
      //
      // `MinKey` and `MaxKey` are the mirror case: they have no payload worth
      // reading (`{}` from the walk) and are told apart by the tag alone, so
      // they are the reason the tag cannot be dropped either.
      const families: {
        label: string;
        tag: string;
        unequal: [unknown, unknown];
        equal: [unknown, unknown];
      }[] = [
        {
          label: "ObjectId",
          tag: "ObjectId",
          unequal: [
            new ObjectId("64b7f9f2b1a2c3d4e5f6a7b8"),
            new ObjectId("64b7f9f2b1a2c3d4e5f6a7b9"),
          ],
          equal: [
            new ObjectId("64b7f9f2b1a2c3d4e5f6a7b8"),
            new ObjectId("64b7f9f2b1a2c3d4e5f6a7b8"),
          ],
        },
        {
          label: "Decimal128",
          tag: "Decimal128",
          unequal: [new Decimal128("1.5"), new Decimal128("1.6")],
          equal: [new Decimal128("1.5"), new Decimal128("1.5")],
        },
        {
          label: "Long",
          tag: "Long",
          unequal: [Long.fromNumber(1), Long.fromNumber(2)],
          equal: [Long.fromNumber(1), Long.fromNumber(1)],
        },
        {
          label: "Int32",
          tag: "Int32",
          unequal: [new Int32(1), new Int32(2)],
          equal: [new Int32(1), new Int32(1)],
        },
        {
          label: "Double",
          tag: "Double",
          unequal: [new Double(1), new Double(2)],
          equal: [new Double(1), new Double(1)],
        },
        {
          label: "Timestamp",
          tag: "Timestamp",
          unequal: [Timestamp.fromNumber(1), Timestamp.fromNumber(2)],
          equal: [Timestamp.fromNumber(1), Timestamp.fromNumber(1)],
        },
        {
          label: "BSONSymbol",
          tag: "BSONSymbol",
          unequal: [new BSONSymbol("a"), new BSONSymbol("b")],
          equal: [new BSONSymbol("a"), new BSONSymbol("a")],
        },
        {
          label: "Binary (printable bytes)",
          tag: "Binary",
          unequal: [new Binary(Buffer.from("A")), new Binary(Buffer.from("B"))],
          equal: [new Binary(Buffer.from("A")), new Binary(Buffer.from("A"))],
        },
        {
          label: "Binary (non-UTF-8 bytes)",
          tag: "Binary",
          unequal: [
            new Binary(Buffer.from([0xff, 0xfe, 0x00, 0x01])),
            new Binary(Buffer.from([0xff, 0xfd, 0x00, 0x01])),
          ],
          equal: [
            new Binary(Buffer.from([0xff, 0xfe, 0x00, 0x01])),
            new Binary(Buffer.from([0xff, 0xfe, 0x00, 0x01])),
          ],
        },
        {
          // Same bytes, different `sub_type`: a different BSON value, and one
          // the `String()` rendering could not tell apart at all.
          label: "Binary (sub_type)",
          tag: "Binary",
          unequal: [new Binary(Buffer.from("hi"), 0), new Binary(Buffer.from("hi"), 1)],
          equal: [new Binary(Buffer.from("hi"), 4), new Binary(Buffer.from("hi"), 4)],
        },
        {
          label: "Code",
          tag: "Code",
          unequal: [new Code("a"), new Code("b")],
          equal: [new Code("a"), new Code("a")],
        },
        {
          label: "Code (scope)",
          tag: "Code",
          unequal: [new Code("a"), new Code("a", { x: 1 })],
          equal: [new Code("a", { x: 1 }), new Code("a", { x: 1 })],
        },
        {
          label: "BSONRegExp",
          tag: "BSONRegExp",
          unequal: [new BSONRegExp("^a"), new BSONRegExp("^b")],
          equal: [new BSONRegExp("^a"), new BSONRegExp("^a")],
        },
        {
          label: "BSONRegExp (flags)",
          tag: "BSONRegExp",
          unequal: [new BSONRegExp("^a", "i"), new BSONRegExp("^a", "m")],
          equal: [new BSONRegExp("^a", "i"), new BSONRegExp("^a", "i")],
        },
        {
          label: "DBRef",
          tag: "DBRef",
          unequal: [
            new DBRef("c", new ObjectId("64b7f9f2b1a2c3d4e5f6a7b8")),
            new DBRef("c", new ObjectId("64b7f9f2b1a2c3d4e5f6a7b9")),
          ],
          equal: [
            new DBRef("c", new ObjectId("64b7f9f2b1a2c3d4e5f6a7b8")),
            new DBRef("c", new ObjectId("64b7f9f2b1a2c3d4e5f6a7b8")),
          ],
        },
        {
          label: "MinKey",
          tag: "MinKey",
          unequal: [new MinKey(), new MaxKey()],
          equal: [new MinKey(), new MinKey()],
        },
        {
          label: "MaxKey",
          tag: "MaxKey",
          unequal: [new MaxKey(), new MinKey()],
          equal: [new MaxKey(), new MaxKey()],
        },
        {
          // Sub_type 4, so it renders as the `Binary` it is -- which is correct,
          // not a collision: a `UUID` and a `Binary` over the same bytes with
          // the same sub_type are the same BSON value.
          label: "UUID",
          tag: "Binary",
          unequal: [
            new UUID("64b7f9f2-b1a2-c3d4-e5f6-a7b8a7b8a7b8"),
            new UUID("64b7f9f2-b1a2-c3d4-e5f6-a7b8a7b8a7b9"),
          ],
          equal: [
            new UUID("64b7f9f2-b1a2-c3d4-e5f6-a7b8a7b8a7b8"),
            new UUID("64b7f9f2-b1a2-c3d4-e5f6-a7b8a7b8a7b8"),
          ],
        },
      ];

      for (const { label, tag, unequal, equal } of families) {
        const mismatch = compare({ v: unequal[0] }, { v: unequal[1] });
        expect(mismatch, `${label}: unequal instances must be a mismatch`).not.toBeNull();
        // The tag has to survive into the warning, or an operator sees two
        // payloads with nothing saying what kind of value they are.
        expect(mismatch).toContain(`BSON(${tag}`);

        expect(
          compare({ v: equal[0] }, { v: equal[1] }),
          `${label}: equal instances must be equivalent`,
        ).toBeNull();
      }
    });

    it("bounds a large byte payload without conflating two that differ past the prefix", () => {
      // A payload walked naively is a `Buffer` whose own enumerable properties
      // are one entry per byte: a megabyte-long filter would print a
      // megabyte-long warning. The prefix is capped instead, and because a bare
      // prefix would report two payloads as equal when they share it, the
      // rendering carries the length and a checksum over *every* byte -- so what
      // is elided is the rendering, not the identity.
      const megabyte = Buffer.alloc(1024 * 1024, 0x41);
      const differingLate = Buffer.alloc(1024 * 1024, 0x41);
      differingLate[900000] = 0x42;

      const rendered = compare({ v: new Binary(megabyte) }, { v: new Binary(Buffer.alloc(1)) });
      expect(rendered!.length).toBeLessThan(400);

      expect(
        compare({ v: new Binary(megabyte) }, { v: new Binary(differingLate) }),
        "two payloads differing only past the rendered prefix must still differ",
      ).not.toBeNull();
      expect(
        compare({ v: new Binary(megabyte) }, { v: new Binary(Buffer.alloc(1024 * 1024, 0x41)) }),
      ).toBeNull();
    });

    it("does not throw on any input, however hostile", () => {
      // The guarantee the doc comment makes is behavioural: no input makes
      // `canonicalize` throw. Every one of these threw before it was written --
      // `new Proxy(new Date(0), {})` because `instanceof Date` passes through
      // the proxy's `getPrototypeOf` while `getTime` needs a `[[DateValue]]`
      // slot the proxy does not have; a `Date` subclass whose `toISOString` is
      // overridden because the old guard covered only the invalid-date case; a
      // revoked `Proxy` and an object with a throwing getter because the walk
      // read through them unguarded.
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();

      class ThrowingIso extends Date {
        toISOString(): string {
          throw new Error("toISOString");
        }
      }

      const hostile: [string, unknown][] = [
        ["a Proxy over a Date", new Proxy(new Date(0), {})],
        ["a Date subclass with a throwing toISOString", new ThrowingIso(0)],
        ["a Symbol", Symbol("x")],
        ["a BigInt", BigInt(1)],
        ["an invalid Date", new Date("nonsense")],
        ["NaN", NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
        ["a revoked Proxy", revocable.proxy],
        [
          "an object with a throwing getter",
          {
            get boom(): never {
              throw new Error("getter");
            },
          },
        ],
        ["a throwing getter nested one level down", { outer: { get boom(): never { throw new Error("getter"); } } }],
        ["an object with a throwing toString", { toString: () => { throw new Error("toString"); } }],
      ];

      for (const [label, value] of hostile) {
        expect(() => compare({ v: value }, { v: value }), `${label} must not throw`).not.toThrow();
        // And the same value placed beside a plain one, so the walk has to
        // render the hostile value as a *member* rather than as the whole input.
        expect(
          () => compare({ v: value, other: 1 }, { v: value, other: 1 }),
          `${label} must not throw as a member`,
        ).not.toThrow();
      }

      // Two values that cannot be rendered compare equal, which is the stated
      // limit of the guarantee rather than a gap: neither can be compared.
      const first = new Proxy(new Date(0), {});
      const second = new Proxy(new Date(1), {});
      expect(compare({ v: first }, { v: second })).toBeNull();

      // A throwing getter costs its own entry, not the walk: the sibling key
      // still renders, and the entry that could not be read is marked rather
      // than silently dropped.
      const partly = compare(
        { v: { good: "kept", get bad(): never { throw new Error("getter"); } } },
        { v: { good: "kept", get bad(): never { throw new Error("getter"); } } },
      );
      expect(partly).toBeNull();
      const shown = compare(
        { v: { good: "kept", get bad(): never { throw new Error("getter"); } } },
        { v: {} },
      );
      expect(shown).toContain('"good":"kept"');
      expect(shown).toContain('"bad":<unreadable>');
    });

    it("treats -0 and 0 as the same filter, which they are", () => {
      // Deliberately not "fixed": measured against a live server, MongoDB treats
      // them as one value -- a query on either matches both documents, and
      // `distinct` returns one. Two filters that select the same documents are
      // the same filter, so reporting them equivalent is correct, and a test
      // asserting they differ would be asserting a falsehood.
      expect(compare({ $gt: -0 }, { $gt: 0 })).toBeNull();
    });

    it("distinguishes RegExps by source and by flags", () => {
      expect(compare({ $regex: /^abc/ }, { $regex: /^abd/ })).toContain(
        "partialFilterExpression differs",
      );
      // Same source, different flags: still a different filter.
      expect(compare({ $regex: /^abc/i }, { $regex: /^abc/ })).toContain(
        "partialFilterExpression differs",
      );
      expect(compare({ $regex: /^abc/ }, { $regex: /^abc/ })).toBeNull();
    });

    it("distinguishes bigints, which JSON has no form for", () => {
      // `BigInt(1)` rather than `1n`: tsconfig targets ES2017, and the literal
      // form is a syntax error below ES2020. `JSON.stringify` throws on a
      // bigint, so before this case existed the function was not merely
      // collision-prone here, it was not total.
      expect(compare({ $gt: BigInt(2) }, { $gt: BigInt(1) })).toContain(
        "partialFilterExpression differs",
      );
      expect(compare({ $gt: BigInt(1) }, { $gt: BigInt(1) })).toBeNull();
    });
  });
});
