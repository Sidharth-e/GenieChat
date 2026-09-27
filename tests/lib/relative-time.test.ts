import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "@/lib/relative-time";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("handles just-now, minutes, hours, days", () => {
    expect(formatRelativeTime("2026-09-25T11:59:40Z")).toBe("just now");
    expect(formatRelativeTime("2026-09-25T11:58:00Z")).toBe("2m ago");
    expect(formatRelativeTime("2026-09-25T10:00:00Z")).toBe("2h ago");
    expect(formatRelativeTime("2026-09-23T12:00:00Z")).toBe("2d ago");
  });
  it("returns a short date beyond 7 days", () => {
    expect(formatRelativeTime("2026-09-01T12:00:00Z")).toBe("Sep 1");
  });
  it("is safe on missing/invalid/future input", () => {
    expect(formatRelativeTime(undefined)).toBe("");
    expect(formatRelativeTime("not-a-date")).toBe("");
    expect(formatRelativeTime("2026-09-25T12:05:00Z")).toBe("just now");
  });
});
