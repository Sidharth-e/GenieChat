import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  getExecutor,
  registerExecutor,
  validateTarget,
  type TriggerExecutor,
} from "@/lib/schedules/registry";

/**
 * The registry is pure — a `Map`, an accessor and a delegating lookup — so it is
 * unit-tested here rather than left to an integration suite. The executor that
 * phase 1 registers is not: it reaches MongoDB and the workflow service, and is
 * exercised against a live stack instead.
 *
 * Ordering matters in this file. The registry holds one process-global `Map`, so
 * the assertions about a type *not* being registered have to run before the
 * registration below; vitest runs the blocks in declaration order.
 */

/**
 * A stand-in executor for a type phase 1 deliberately leaves unregistered.
 *
 * `type: "tool"` is the choice that keeps the ordering note above honest — phase
 * 1 registers `workflow` only, so nothing else in the suite can be the thing
 * that put an entry under `tool`.
 */
function fakeExecutor(overrides: Partial<TriggerExecutor> = {}): TriggerExecutor {
  return {
    type: "tool",
    inputSchema: z.object({}),
    validate: async () => ({ ok: true, name: "fake" }),
    describe: async () => ({ name: "fake" }),
    execute: async () => ({}),
    ...overrides,
  };
}

describe("getExecutor before anything registers", () => {
  it("returns null for the types phase 1 does not implement", () => {
    // Null, not a stub that throws later: this is the signal that makes a
    // schedule targeting an unimplemented kind fail at save time rather than at
    // 3am in a background tick.
    expect(getExecutor("tool")).toBeNull();
    expect(getExecutor("agent")).toBeNull();
  });
});

describe("validateTarget", () => {
  it("answers invalid_target for a type with no executor", async () => {
    const result = await validateTarget("user_1", { type: "tool", id: "t_1" });
    expect(result).toEqual({ ok: false, code: "invalid_target" });
  });
});

describe("registerExecutor", () => {
  it("makes the executor retrievable by its own type", () => {
    const executor = fakeExecutor();
    registerExecutor(executor);
    expect(getExecutor("tool")).toBe(executor);
  });

  it("delegates validation, passing the caller and target through", async () => {
    const validate = vi.fn(async () => ({ ok: false, code: "unauthorized" }) as const);
    registerExecutor(fakeExecutor({ validate }));

    const result = await validateTarget("user_1", { type: "tool", id: "t_9" });

    // A registry that reached for the target itself, or dropped the caller,
    // would let a schedule run another user's target — the whole reason
    // `validate` exists on the executor rather than in this module.
    expect(validate).toHaveBeenCalledWith("user_1", "t_9");
    expect(result).toEqual({ ok: false, code: "unauthorized" });
  });
});
