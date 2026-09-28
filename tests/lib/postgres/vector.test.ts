import { describe, expect, it } from "vitest";
import { toVectorLiteral } from "@/lib/postgres/vector";

describe("toVectorLiteral", () => {
  it("renders a bracketed, comma-separated literal", () => {
    expect(toVectorLiteral([1, 2, 3])).toBe("[1,2,3]");
  });

  it("preserves fractional values", () => {
    expect(toVectorLiteral([0.5, -1.25])).toBe("[0.5,-1.25]");
  });

  it("renders an empty vector as empty brackets", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("rejects values that would break out of the literal", () => {
    expect(() => toVectorLiteral([Number.NaN])).toThrow(/finite/i);
    expect(() => toVectorLiteral([Number.POSITIVE_INFINITY])).toThrow(/finite/i);
  });

  it("renders a 768-dimension vector without a trailing comma", () => {
    const literal = toVectorLiteral(Array.from({ length: 768 }, () => 0.1));
    expect(literal.startsWith("[0.1,0.1")).toBe(true);
    expect(literal.endsWith(",]")).toBe(false);
    expect(literal.endsWith("]")).toBe(true);
    expect(literal.split(",")).toHaveLength(768);
  });
});
