import { describe, expect, it } from "vitest";
import {
  describeTargetError,
  nextRunAtAfterPatch,
  parseScheduleDraft,
  parseSchedulePatch,
} from "@/lib/schedules/schedule-input";
import {
  SCHEDULE_CATCH_UP_POLICIES,
  SCHEDULE_MAX_ATTEMPTS,
  SCHEDULE_OVERLAP_POLICIES,
  SCHEDULE_TARGET_TYPES,
} from "@/constants/schedules";
import type { Schedule } from "@/lib/types";

const NOW = new Date("2026-10-05T06:00:00.000Z");

const validBody = () => ({
  name: "Morning digest",
  target: { type: "agent", id: "agent_1" },
  input: { message: "Summarise yesterday" },
  cadence: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
});

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: "sched_1",
  userId: "user_1",
  name: "Existing",
  target: { type: "agent", id: "agent_1" },
  input: { message: "hello" },
  cadence: { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
  enabled: true,
  overlapPolicy: "skip",
  catchUpPolicy: "skip",
  maxAttempts: 3,
  nextRunAt: "2026-10-06T09:00:00.000Z",
  skippedRuns: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

describe("parseScheduleDraft", () => {
  it("accepts a well-formed draft and applies the defaults", () => {
    const result = parseScheduleDraft(validBody(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: "Morning digest",
      target: { type: "agent", id: "agent_1" },
      input: { message: "Summarise yesterday" },
      cadence: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
      enabled: true,
      overlapPolicy: "skip",
      catchUpPolicy: "skip",
      maxAttempts: 3,
    });
  });

  it("rejects a body that is not an object", () => {
    expect(parseScheduleDraft("nope", NOW).ok).toBe(false);
    expect(parseScheduleDraft(null, NOW).ok).toBe(false);
  });

  it("rejects a missing or blank name", () => {
    expect(parseScheduleDraft({ ...validBody(), name: "  " }, NOW).ok).toBe(false);
    expect(parseScheduleDraft({ ...validBody(), name: undefined }, NOW).ok).toBe(false);
  });

  it("trims the name and omits an empty description", () => {
    const result = parseScheduleDraft(
      { ...validBody(), name: "  Digest  ", description: "   " },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Digest");
    expect(result.value.description).toBeUndefined();
  });

  it("rejects an unknown target type", () => {
    const result = parseScheduleDraft(
      { ...validBody(), target: { type: "database", id: "x" } },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a target with no id", () => {
    const result = parseScheduleDraft(
      { ...validBody(), target: { type: "agent", id: "" } },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a cadence that cannot fire", () => {
    const result = parseScheduleDraft(
      {
        ...validBody(),
        cadence: { kind: "cron", expression: "0 0 30 2 *", timezone: "UTC" },
      },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("never");
  });

  // Review Focus 1, the `once` half: a past instant is rejected here, at the
  // edge, rather than stored as an enabled schedule that never fires.
  it("rejects a once cadence in the past", () => {
    const result = parseScheduleDraft(
      { ...validBody(), cadence: { kind: "once", runAt: "2026-10-04T09:00:00.000Z" } },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("defaults a missing input to an empty object rather than undefined", () => {
    const result = parseScheduleDraft({ ...validBody(), input: undefined }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.input).toEqual({});
  });

  // Review Focus 2: the boundaries are the point. `0` reaches the tick's
  // `|| SCHEDULE_DEFAULT_MAX_ATTEMPTS` and silently becomes 3.
  it("rejects maxAttempts below 1 and above the ceiling", () => {
    for (const maxAttempts of [0, -1, 1.5, SCHEDULE_MAX_ATTEMPTS + 1, 100000]) {
      expect(
        parseScheduleDraft({ ...validBody(), maxAttempts }, NOW).ok,
        `maxAttempts=${maxAttempts}`,
      ).toBe(false);
    }
  });

  it("accepts maxAttempts at both boundaries", () => {
    for (const maxAttempts of [1, SCHEDULE_MAX_ATTEMPTS]) {
      expect(
        parseScheduleDraft({ ...validBody(), maxAttempts }, NOW).ok,
        `maxAttempts=${maxAttempts}`,
      ).toBe(true);
    }
  });

  it("rejects a policy outside its union", () => {
    expect(
      parseScheduleDraft({ ...validBody(), overlapPolicy: "queue" }, NOW).ok,
    ).toBe(false);
    expect(
      parseScheduleDraft({ ...validBody(), catchUpPolicy: "run" }, NOW).ok,
    ).toBe(false);
  });

  it("accepts a false enabled rather than defaulting it to true", () => {
    const result = parseScheduleDraft({ ...validBody(), enabled: false }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enabled).toBe(false);
  });

  it("rejects a non-boolean enabled", () => {
    expect(parseScheduleDraft({ ...validBody(), enabled: "yes" }, NOW).ok).toBe(false);
  });

  it("carries no description for a create that cleared it", () => {
    // Erasure is a patch-only idea: a create has nothing to erase, so the empty
    // spelling has to come out as "no description at all" rather than as a null
    // the insert would store.
    const result = parseScheduleDraft({ ...validBody(), description: "" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBeUndefined();
  });

  // The runtime lists and the unions in lib/types.ts are two spellings of one
  // fact; this is the test that fails when they drift.
  it("agrees with the unions it mirrors", () => {
    expect([...SCHEDULE_TARGET_TYPES]).toEqual(["workflow", "agent", "tool"]);
    expect([...SCHEDULE_OVERLAP_POLICIES]).toEqual(["skip", "allow"]);
    expect([...SCHEDULE_CATCH_UP_POLICIES]).toEqual(["skip", "once"]);
  });
});

describe("parseSchedulePatch", () => {
  it("accepts an empty patch and sets nothing", () => {
    const result = parseSchedulePatch({}, NOW);
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("accepts a single-field pause", () => {
    const result = parseSchedulePatch({ enabled: false }, NOW);
    expect(result).toEqual({ ok: true, value: { enabled: false } });
  });

  it("leaves an absent field absent rather than defaulting it", () => {
    const result = parseSchedulePatch({ name: "Renamed" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ name: "Renamed" });
    expect("enabled" in result.value).toBe(false);
    expect("maxAttempts" in result.value).toBe(false);
  });

  it("rejects a cadence that cannot fire", () => {
    const result = parseSchedulePatch(
      { cadence: { kind: "cron", expression: "every so often", timezone: "UTC" } },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an out-of-range maxAttempts in a patch too", () => {
    expect(parseSchedulePatch({ maxAttempts: 0 }, NOW).ok).toBe(false);
  });

  it("rejects an explicitly undefined field rather than accepting it as a set", () => {
    expect(parseSchedulePatch({ name: undefined }, NOW).ok).toBe(false);
  });

  // A description was settable but not erasable. The editor sent `undefined` for a
  // cleared field, `JSON.stringify` dropped the key, and the patch never mentioned
  // it -- so clearing the box and saving left the old text in place. An erasure
  // now travels as `null`, which is a value the store can act on and `undefined`
  // cannot be, since `undefined` already means "absent".
  it("erases a description cleared to an empty string", () => {
    expect(parseSchedulePatch({ description: "" }, NOW)).toEqual({
      ok: true,
      value: { description: null },
    });
  });

  it("erases a whitespace-only description", () => {
    expect(parseSchedulePatch({ description: "   " }, NOW)).toEqual({
      ok: true,
      value: { description: null },
    });
  });

  it("erases a description sent as null", () => {
    expect(parseSchedulePatch({ description: null }, NOW)).toEqual({
      ok: true,
      value: { description: null },
    });
  });

  it("keeps a real description, trimmed", () => {
    expect(parseSchedulePatch({ description: "  Keep me  " }, NOW)).toEqual({
      ok: true,
      value: { description: "Keep me" },
    });
  });

  it("leaves an absent description absent rather than erasing it", () => {
    const result = parseSchedulePatch({ name: "Renamed" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("description" in result.value).toBe(false);
  });
});

describe("nextRunAtAfterPatch", () => {
  it("does not move nextRunAt when the patch does not mention the cadence", () => {
    expect(
      nextRunAtAfterPatch(NOW, schedule(), { name: "Renamed" }),
    ).toEqual({ update: false, nextRunAt: null });
  });

  // Review Focus 1: pausing is `enabled: false` and nothing else, so the stored
  // instant must survive it. Moving it here is what makes a resume fire the
  // instant the switch flips.
  it("does not move nextRunAt when the patch pauses the schedule", () => {
    expect(
      nextRunAtAfterPatch(NOW, schedule(), { enabled: false }),
    ).toEqual({ update: false, nextRunAt: null });
  });

  it("recomputes from now when a paused schedule is resumed", () => {
    const paused = schedule({
      enabled: false,
      nextRunAt: "2026-10-01T09:00:00.000Z", // five days in the past
    });
    expect(nextRunAtAfterPatch(NOW, paused, { enabled: true })).toEqual({
      update: true,
      nextRunAt: "2026-10-05T09:00:00.000Z",
    });
  });

  it("recomputes when the patch replaces the cadence", () => {
    expect(
      nextRunAtAfterPatch(NOW, schedule(), {
        cadence: { kind: "cron", expression: "0 12 * * *", timezone: "UTC" },
      }),
    ).toEqual({ update: true, nextRunAt: "2026-10-05T12:00:00.000Z" });
  });

  it("does not move nextRunAt when an enabled schedule is saved unchanged", () => {
    // `enabled: true` on an already-enabled schedule is a no-op, not a resume:
    // recomputing there would shift a schedule whose next run is imminent.
    const imminent = schedule({ nextRunAt: "2026-10-05T06:02:00.000Z" });
    expect(nextRunAtAfterPatch(NOW, imminent, { enabled: true })).toEqual({
      update: false,
      nextRunAt: null,
    });
  });

  it("stores null for a resumed once cadence that can no longer fire", () => {
    const paused = schedule({
      enabled: false,
      cadence: { kind: "once", runAt: "2026-10-04T09:00:00.000Z" },
    });
    expect(nextRunAtAfterPatch(NOW, paused, { enabled: true })).toEqual({
      update: true,
      nextRunAt: null,
    });
  });
});

describe("describeTargetError", () => {
  it("gives each code a distinct sentence", () => {
    const messages = (
      ["target_not_found", "unauthorized", "invalid_target"] as const
    ).map(describeTargetError);
    expect(new Set(messages).size).toBe(3);
    for (const message of messages) expect(message).toBeTruthy();
  });
});
