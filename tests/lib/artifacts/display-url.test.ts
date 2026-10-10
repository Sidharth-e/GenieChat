import { describe, it, expect } from "vitest";
import {
  resolveArtifactDisplayUrl,
  storageDownloadUrl,
} from "@/lib/artifacts/display-url";

/**
 * The tool that stores a generated image writes this URL into the reply's
 * markdown, so it is read out of a persisted message long after it was built —
 * it has to be the resigning proxy, never a signature with an expiry.
 */
describe("storageDownloadUrl", () => {
  it("points at the download proxy with the ref percent-encoded", () => {
    expect(storageDownloadUrl("s3://generated-images/u1/image/a.png")).toBe(
      "/api/storage/download?ref=s3%3A%2F%2Fgenerated-images%2Fu1%2Fimage%2Fa.png",
    );
  });
});

/**
 * The card and the list row each render whatever this returns, so the allowlist
 * is the single place that decides whether an artifact is openable. A value
 * that slipped through as "usable" would put a broken image or a dead link in
 * front of the user.
 */
describe("resolveArtifactDisplayUrl", () => {
  it("routes a storage ref through the ownership-checking proxy", () => {
    expect(
      resolveArtifactDisplayUrl("s3://chat-images/u1/diagram.png"),
    ).toEqual({
      url: `/api/storage/download?ref=${encodeURIComponent(
        "s3://chat-images/u1/diagram.png",
      )}`,
      usable: true,
    });
  });

  it("percent-encodes a ref that carries reserved characters", () => {
    const { url } = resolveArtifactDisplayUrl("s3://chat-images/u1/a b&c.png");
    expect(url).toBe(
      "/api/storage/download?ref=s3%3A%2F%2Fchat-images%2Fu1%2Fa%20b%26c.png",
    );
  });

  it("passes an http(s) URL through untouched", () => {
    const https = "https://cdn.example.com/a.png";
    expect(resolveArtifactDisplayUrl(https)).toEqual({
      url: https,
      usable: true,
    });
    expect(resolveArtifactDisplayUrl("http://cdn.example.com/a.png").usable).toBe(
      true,
    );
  });

  it("rejects a bare bucket path that is neither a ref nor http(s)", () => {
    expect(resolveArtifactDisplayUrl("generated-images/u1/a.png")).toEqual({
      url: "generated-images/u1/a.png",
      usable: false,
    });
  });

  it.each([[""], ["not a url"], ["ftp://example.com/a.png"], ["s3:a/b"]])(
    "treats %j as unusable",
    (value) => {
      expect(resolveArtifactDisplayUrl(value).usable).toBe(false);
    },
  );
});
