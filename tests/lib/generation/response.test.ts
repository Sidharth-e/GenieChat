import { describe, expect, it } from "vitest";

import {
  extensionForMediaType,
  mediaTypeForExtension,
  parseImageResponse,
} from "@/lib/generation/response";

/** Factory rather than an inline literal, so a new field reaches every case. */
function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    created: 1748372400,
    data: [{ b64_json: "aGVsbG8=", media_type: "image/png" }],
    ...overrides,
  };
}

describe("extensionForMediaType", () => {
  it("maps the formats the API can declare", () => {
    expect(extensionForMediaType("image/png")).toBe("png");
    expect(extensionForMediaType("image/jpeg")).toBe("jpg");
    expect(extensionForMediaType("image/webp")).toBe("webp");
    expect(extensionForMediaType("image/svg+xml")).toBe("svg");
  });

  it("is case-insensitive", () => {
    expect(extensionForMediaType("IMAGE/PNG")).toBe("png");
  });

  it("accepts the non-standard image/jpg alias", () => {
    expect(extensionForMediaType("image/jpg")).toBe("jpg");
  });

  it("defaults to png for an undeclared or unrecognised type", () => {
    expect(extensionForMediaType(undefined)).toBe("png");
    expect(extensionForMediaType("")).toBe("png");
    expect(extensionForMediaType("image/avif")).toBe("png");
  });
});

describe("mediaTypeForExtension", () => {
  it("names the canonical type for an extension", () => {
    expect(mediaTypeForExtension("png")).toBe("image/png");
    expect(mediaTypeForExtension("webp")).toBe("image/webp");
    expect(mediaTypeForExtension("svg")).toBe("image/svg+xml");
  });

  it("prefers the standard type when an extension has an alias", () => {
    expect(mediaTypeForExtension("jpg")).toBe("image/jpeg");
  });

  it("round-trips every type it can produce", () => {
    for (const mediaType of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) {
      expect(mediaTypeForExtension(extensionForMediaType(mediaType))).toBe(
        mediaType,
      );
    }
  });

  it("defaults to png for an unknown extension", () => {
    expect(mediaTypeForExtension("avif")).toBe("image/png");
  });
});

describe("parseImageResponse", () => {
  it("returns the image bytes and media type", () => {
    const parsed = parseImageResponse(responseBody());

    expect(parsed?.images).toEqual([
      { base64: "aGVsbG8=", mediaType: "image/png" },
    ]);
  });

  it("carries the provider's reported cost when present", () => {
    const parsed = parseImageResponse(
      responseBody({ usage: { prompt_tokens: 0, total_tokens: 4175, cost: 0.04 } }),
    );

    expect(parsed?.costUsd).toBe(0.04);
  });

  it("omits the cost when the response does not report one", () => {
    expect(parseImageResponse(responseBody())?.costUsd).toBeUndefined();
    expect(
      parseImageResponse(responseBody({ usage: { total_tokens: 12 } }))?.costUsd,
    ).toBeUndefined();
  });

  it("rejects anything that is not a response body", () => {
    expect(parseImageResponse(undefined)).toBeNull();
    expect(parseImageResponse(null)).toBeNull();
    expect(parseImageResponse("nope")).toBeNull();
    expect(parseImageResponse("42")).toBeNull();
    expect(parseImageResponse({ created: 1 })).toBeNull();
    expect(parseImageResponse({ data: "nope" })).toBeNull();
  });

  it("rejects a response whose data array holds no image", () => {
    expect(parseImageResponse({ data: [] })).toBeNull();
    expect(parseImageResponse({ data: [{ media_type: "image/png" }] })).toBeNull();
    expect(parseImageResponse({ data: [{ b64_json: "" }] })).toBeNull();
    expect(parseImageResponse({ data: [null, "nope"] })).toBeNull();
  });

  it("keeps the usable entries when a sibling is unusable", () => {
    const parsed = parseImageResponse({
      data: [{ b64_json: "" }, { b64_json: "aGVsbG8=", media_type: "image/webp" }],
    });

    expect(parsed?.images).toEqual([
      { base64: "aGVsbG8=", mediaType: "image/webp" },
    ]);
  });

  it("reports an empty media type rather than inventing one", () => {
    const parsed = parseImageResponse({ data: [{ b64_json: "aGVsbG8=" }] });

    expect(parsed?.images[0].mediaType).toBe("");
  });
});
