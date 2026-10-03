import { describe, it, expect, vi, afterEach } from "vitest";
import type { RichWorkflowMetadataUpdate } from "@/lib/mongodb/workflow-store";

/**
 * Unit tests for the pure helpers in `lib/mongodb/workflow-store.ts`.
 *
 * Scope is deliberately these functions only. The store's own methods are
 * I/O-bound (`findOne`/`replaceOne` against Mongo), which CLAUDE.md classifies
 * as an integration-test candidate rather than something to unit-test with
 * mocks; the version filter those writes carry is asserted at the route level
 * instead.
 */

// Importing the store reaches `lib/env.ts` eagerly, through `./client` ->
// `@/lib/config`, and that module parses `process.env` at load time and throws
// when the required key is missing. Vitest does not load `.env` into
// `process.env`, so the key is stubbed before the import; neither helper under
// test reads it, and a real value already present is kept. Static imports are
// hoisted above this file's body, hence the dynamic import below.
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

const { nextUpdatedAt, mergeRichWorkflowUpdate } = await import(
  "@/lib/mongodb/workflow-store"
);
// `dropUndefinedFields` is shared by every store that builds a partial update,
// so it lives in `common` rather than in the workflow store it started in.
const { dropUndefinedFields } = await import("@/lib/mongodb/common");

/** The stored-document shape `mergeRichWorkflowUpdate` takes, taken from the helper itself. */
type StoredRichWorkflow = Parameters<typeof mergeRichWorkflowUpdate>[0];

/** A canonical UTC ISO instant, as `Date#toISOString` produces it. */
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("nextUpdatedAt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never returns its input, for a past, equal-to-now, or future value", () => {
    // The property the whole claim compare-and-swap rests on: a write must
    // never store the value its own filter compared against, or two writers
    // holding the same version could both match.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    const past = "2020-01-01T00:00:00.000Z";
    const equalToNow = "2026-06-15T12:00:00.000Z";
    const future = "2099-01-01T00:00:00.000Z";

    for (const input of [past, equalToNow, future]) {
      expect(nextUpdatedAt(input)).not.toBe(input);
    }
  });

  it("advances by one millisecond when the write lands in the same millisecond", () => {
    // The exact case that double-claimed 4 rounds in 25 before this guarantee
    // existed: two writers in one millisecond, storing a byte-identical value.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(nextUpdatedAt("2026-01-01T00:00:00.000Z")).toBe(
      "2026-01-01T00:00:00.001Z",
    );
  });

  it("rolls over through the second when the bump crosses it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-12-31T23:59:59.998Z"));

    expect(nextUpdatedAt("2099-12-31T23:59:59.999Z")).toBe(
      "2100-01-01T00:00:00.000Z",
    );
  });

  it("returns the wall clock for a value older than the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    expect(nextUpdatedAt("2020-01-01T00:00:00.000Z")).toBe(
      "2026-06-15T12:00:00.000Z",
    );
  });

  it("falls back to the wall clock without throwing on malformed input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    // "" is what the insert path relies on when the key is absent.
    for (const input of ["", "not-a-date"]) {
      expect(() => nextUpdatedAt(input)).not.toThrow();
      expect(nextUpdatedAt(input)).toBe("2026-06-15T12:00:00.000Z");
    }
  });

  it("always returns canonical UTC ISO, past or future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    for (const input of [
      "2020-01-01T00:00:00.000Z",
      "2026-06-15T12:00:00.000Z",
      "2099-12-31T23:59:59.999Z",
      "",
      "not-a-date",
    ]) {
      expect(nextUpdatedAt(input)).toMatch(CANONICAL_ISO);
    }
  });

  it("returns a value lexicographically greater than canonical ISO input", () => {
    // Lexicographic and chronological order coincide only for this canonical
    // form, which is what lets the CAS compare values as strings.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    for (const input of [
      "2020-01-01T00:00:00.000Z",
      "2026-06-15T12:00:00.000Z",
      "2099-12-31T23:59:59.999Z",
    ]) {
      expect(nextUpdatedAt(input) > input).toBe(true);
    }
  });

  it("can run ahead of the clock, never behind it", () => {
    // The real invariant is max(wall clock, previous + 1 ms): while the clock
    // does not move past the value, consecutive writes drift a further 1 ms
    // ahead. Only "not earlier than the clock" is promised, so this pins the
    // drift that `updatedAt <= Date.now()` would wrongly deny.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    let value = "2026-01-01T00:00:00.000Z";
    for (let i = 0; i < 3; i++) {
      value = nextUpdatedAt(value);
    }

    expect(value).toBe("2026-01-01T00:00:00.003Z");
    expect(value > new Date(Date.now()).toISOString()).toBe(true);

    // The first write at least a millisecond later resets it to the clock.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    expect(nextUpdatedAt(value)).toBe("2026-01-01T00:00:00.500Z");
  });
});

describe("dropUndefinedFields", () => {
  /**
   * A partial update as the routes build one: the fields the caller sent, plus
   * the fields it did not, present-with-`undefined` because the route passes
   * every body key through as a shorthand property. Factored so the mixed shape
   * lives in one place.
   */
  function partialDoc(): Record<string, unknown> {
    return {
      name: "weekly report",
      trigger: undefined,
      lastRunAt: undefined,
      isPublished: false,
      description: "",
      priority: 0,
      customField: null,
    };
  }

  it("removes every undefined-valued key, leaving an absent key", () => {
    const doc = partialDoc();
    // Present-with-undefined before the call: that own key is exactly what
    // displaces the stored value in a merge-over-read followed by replaceOne.
    expect("trigger" in doc).toBe(true);
    expect("lastRunAt" in doc).toBe(true);

    const result = dropUndefinedFields(doc);

    // `in` (and hasOwnProperty), not a falsy check: `undefined` and `null` are
    // both falsy, and only one of them is the hole this helper removes.
    expect("trigger" in result).toBe(false);
    expect("lastRunAt" in result).toBe(false);
    expect(result).not.toHaveProperty("trigger");
    expect(result).not.toHaveProperty("lastRunAt");
  });

  it("keeps an explicit null, which is a value the caller chose", () => {
    const doc = partialDoc();

    const result = dropUndefinedFields(doc);

    expect("customField" in result).toBe(true);
    expect(result.customField).toBeNull();
  });

  it("keeps defined falsy values", () => {
    const doc = partialDoc();

    const result = dropUndefinedFields(doc);

    expect("isPublished" in result).toBe(true);
    expect(result.isPublished).toBe(false);
    expect("description" in result).toBe(true);
    expect(result.description).toBe("");
    expect("priority" in result).toBe(true);
    expect(result.priority).toBe(0);
  });

  it("returns the same object it was given", () => {
    const doc = partialDoc();

    expect(dropUndefinedFields(doc)).toBe(doc);
  });
});

describe("mergeRichWorkflowUpdate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A stored rich-workflow document as the database returns it. Built by a
   * factory so the full shape lives in one place; `overrides` supplies the
   * field under test.
   */
  function storedRichWorkflow(
    overrides: Partial<StoredRichWorkflow> = {},
  ): StoredRichWorkflow {
    return {
      id: "wf_1",
      _id: "wf_1",
      userId: "user_1",
      userName: "Ada",
      userEmail: "ada@example.com",
      type: "rich_workflow",
      name: "nightly",
      nodes: [],
      edges: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  const WEBHOOK_TRIGGER = {
    type: "webhook" as const,
    config: { webhookSecret: "whsec_1" },
  };

  it("keeps a stored trigger through a metadata-only rename", () => {
    // The regression, directly: the helper tests all passed while this sequence
    // clobbered the trigger, because none of them exercised the merge. A rename
    // must not clear the trigger the workflow never mentioned.
    const existing = storedRichWorkflow({ trigger: WEBHOOK_TRIGGER });

    const result = mergeRichWorkflowUpdate(existing, { name: "renamed" });

    expect(result.name).toBe("renamed");
    expect(result.trigger).toEqual(WEBHOOK_TRIGGER);
  });

  it("treats a present-but-undefined key as unchanged, not as erasure", () => {
    const existing = storedRichWorkflow({ trigger: WEBHOOK_TRIGGER });

    const result = mergeRichWorkflowUpdate(existing, { trigger: undefined });

    expect(result.trigger).toEqual(WEBHOOK_TRIGGER);
  });

  it("cannot be re-owned by the caller's updates", () => {
    const existing = storedRichWorkflow();

    const result = mergeRichWorkflowUpdate(existing, {
      name: "x",
      userId: "someone-else",
      type: "workflow",
      createdAt: "1999-01-01T00:00:00.000Z",
    } as RichWorkflowMetadataUpdate);

    expect(result.userId).toBe("user_1");
    expect(result.type).toBe("rich_workflow");
    expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.name).toBe("x");
  });

  it("advances updatedAt, even in the same millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const existing = storedRichWorkflow({
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = mergeRichWorkflowUpdate(existing, { name: "x" });

    expect(result.updatedAt).not.toBe(existing.updatedAt);
    expect(result.updatedAt > existing.updatedAt).toBe(true);
  });

  it("does not mutate the caller's updates object", () => {
    const existing = storedRichWorkflow();
    const updates: RichWorkflowMetadataUpdate = {
      name: "x",
      trigger: undefined,
    };

    mergeRichWorkflowUpdate(existing, updates);

    // The helper copies before deleting; the caller's own key must survive.
    expect("trigger" in updates).toBe(true);
  });

  it("preserves the stored trigger when the caller sends the route's full key set", () => {
    // app/api/workflows/[id]/route.ts spreads all six keys into `updates` on
    // every PATCH, so `trigger` arrives as an own key holding `undefined`
    // whenever the body omits it. Dropping keys *after* the spread had already
    // overwritten the stored value, clearing a trigger the PATCH never
    // mentioned. This is that exact input.
    const existing = storedRichWorkflow({ trigger: WEBHOOK_TRIGGER });

    const updated = mergeRichWorkflowUpdate(existing, {
      name: "renamed",
      description: undefined,
      isPublished: undefined,
      visibility: undefined,
      icon: undefined,
      trigger: undefined,
    });

    expect(updated.name).toBe("renamed");
    expect(updated.trigger).toEqual(WEBHOOK_TRIGGER);
  });
});
