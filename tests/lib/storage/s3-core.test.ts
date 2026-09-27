import { describe, it, expect } from "vitest";
import { isNotFoundError } from "@/lib/storage/s3-core";

describe("isNotFoundError", () => {
  it("rejects anything that is not an object", () => {
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError("NoSuchKey")).toBe(false);
    expect(isNotFoundError(404)).toBe(false);
  });

  it("accepts the names the SDK gives a 404", () => {
    expect(isNotFoundError({ name: "NotFound" })).toBe(true);
    expect(isNotFoundError({ name: "NoSuchKey" })).toBe(true);
    // A delete that reaches this branch is a missing bucket (see the doc
    // comment): S3's DeleteObject is idempotent, so a missing *object* never
    // arrives here from a delete.
    expect(isNotFoundError({ name: "NoSuchBucket" })).toBe(true);
  });

  it("falls back to the HTTP status for a shape it does not know", () => {
    expect(isNotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
  });

  it("rejects other statuses and unrelated names", () => {
    expect(isNotFoundError({ $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isNotFoundError({ $metadata: { httpStatusCode: 500 } })).toBe(false);
    expect(isNotFoundError({ name: "AccessDenied" })).toBe(false);
    expect(isNotFoundError({})).toBe(false);
  });
});
