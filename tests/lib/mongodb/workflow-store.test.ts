import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Unit tests for the two pure helpers in `lib/mongodb/workflow-store.ts`.
 *
 * Scope is deliberately these two functions only. The store's own methods are
 * I/O-bound (`findOne`/`replaceOne` against Mongo), which CLAUDE.md classifies
 * as an integration-test candidate rather than something to unit-test with
 * mocks; the concurrency guarantee of `updateWorkflowSchedule` is exercised
 * against a live container instead.
 */

// Importing the store reaches `lib/env.ts` eagerly, through `./client` ->
// `@/lib/config`, and that module parses `process.env` at load time and throws
// when the required key is missing. Vitest does not load `.env` into
// `process.env`, so the key is stubbed before the import; neither helper under
// test reads it, and a real value already present is kept. Static imports are
// hoisted above this file's body, hence the dynamic import below.
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

const { nextUpdatedAt, dropUnsetNextRunAt } = await import(
  "@/lib/mongodb/workflow-store"
);

/** A canonical UTC ISO instant, as `Date#toISOString` produces it. */
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A minimal stand-in for the stored document `dropUnsetNextRunAt` is applied
 * to: an object carrying the optional `nextRunAt` the helper inspects. Built by
 * a factory so the shape lives in one place (CLAUDE.md).
 */
function scheduleDoc(nextRunAt?: string): { nextRunAt?: string } {
  return { nextRunAt };
}

/**
 * The same carrier holding an explicit `null`, which is the value the PATCH
 * path actually produces: `app/api/workflows/[id]/route.ts` sets
 * `updates.nextRunAt = null` when a workflow's trigger stops being a schedule,
 * and `updateWorkflow` spreads that straight into the document it replaces.
 *
 * The helper's parameter is typed `{ nextRunAt?: string }`, so the cast is the
 * only way to hand it that value — and it is the point of the test: the helper's
 * contract at runtime is about `undefined`, not about "falsy".
 */
function scheduleDocWithNull(): { nextRunAt?: string } {
  return { nextRunAt: null } as unknown as { nextRunAt?: string };
}

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

describe("dropUnsetNextRunAt", () => {
  it("removes an undefined nextRunAt, leaving an absent key", () => {
    const doc = scheduleDoc(undefined);
    expect(Object.prototype.hasOwnProperty.call(doc, "nextRunAt")).toBe(true);

    const result = dropUnsetNextRunAt(doc);

    // Cosmos dropped the undefined key on serialisation and read it back as
    // absent; the Mongo driver would store it as `null`. The due schedule
    // depends on the absent shape, so the key must go.
    expect(Object.prototype.hasOwnProperty.call(result, "nextRunAt")).toBe(
      false,
    );
    expect(result).not.toHaveProperty("nextRunAt");
  });

  it("leaves a defined nextRunAt untouched", () => {
    const doc = scheduleDoc("2026-01-01T00:00:00.000Z");

    const result = dropUnsetNextRunAt(doc);

    expect(result.nextRunAt).toBe("2026-01-01T00:00:00.000Z");
    expect(Object.prototype.hasOwnProperty.call(result, "nextRunAt")).toBe(
      true,
    );
  });

  it("keeps an explicit null, which the update path relies on", () => {
    // Not a tidy-up candidate: `app/api/workflows/[id]/route.ts` writes an
    // explicit `null` when a trigger stops being a schedule, and `null` is
    // `IS_DEFINED`-true and never `<=` an ISO string in either store, so it
    // deliberately stays a stored value rather than an absent key. Deleting it
    // would silently change that path.
    const doc = scheduleDocWithNull();

    const result = dropUnsetNextRunAt(doc);

    expect(Object.prototype.hasOwnProperty.call(result, "nextRunAt")).toBe(
      true,
    );
    expect(result.nextRunAt).toBeNull();
  });

  it("returns the same object it was given", () => {
    const doc = scheduleDoc(undefined);

    expect(dropUnsetNextRunAt(doc)).toBe(doc);
  });
});
