import { describe, expect, it } from "vitest";
import { boundedInt } from "@/lib/api/query-params";

const LIMIT = { fallback: 20, min: 1, max: 100 };
const OFFSET = { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER };

describe("boundedInt", () => {
  // The regression this exists for: `Number(null)` is `0`, which is finite and not
  // negative, so a clamp without a minimum answered `0` for an absent parameter --
  // and a Mongo `.limit(0)` is *no limit*. `GET /runs` with no query string
  // returned every run in the collection.
  it("falls back when the parameter is absent", () => {
    expect(boundedInt(null, LIMIT)).toBe(20);
  });

  it("falls back when the parameter is blank", () => {
    expect(boundedInt("", LIMIT)).toBe(20);
    expect(boundedInt("   ", LIMIT)).toBe(20);
  });

  it("falls back when the parameter is not a number", () => {
    expect(boundedInt("all", LIMIT)).toBe(20);
  });

  it("falls back below the minimum rather than clamping up to it", () => {
    // `?limit=0` has to be a page, not an unbounded read. Clamping `0` up to the
    // minimum would make it one row instead of everything, which is a different
    // surprise rather than a fix -- so below-minimum is the fallback.
    expect(boundedInt("0", LIMIT)).toBe(20);
    expect(boundedInt("-5", LIMIT)).toBe(20);
  });

  it("allows zero where zero is a real value", () => {
    // The same function serves `offset`, where `0` is the first page and must
    // survive. That is what `min` is for.
    expect(boundedInt("0", OFFSET)).toBe(0);
  });

  it("caps above the maximum", () => {
    expect(boundedInt("1000", LIMIT)).toBe(100);
  });

  it("keeps a value inside the range", () => {
    expect(boundedInt("25", LIMIT)).toBe(25);
  });

  it("floors a fractional value", () => {
    expect(boundedInt("12.9", LIMIT)).toBe(12);
  });
});
