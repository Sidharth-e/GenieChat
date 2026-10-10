import { describe, expect, it } from "vitest";

import {
  VIDEO_FENCE_LANGUAGE,
  parseVideoFence,
  videoFenceMarkdown,
} from "@/lib/video";

const URL = "/api/storage/download?ref=s3%3A%2F%2Fgenerated-videos%2Fu1%2Fvideo%2Fa.mp4";

/** The fence body, as the renderer receives it — inner text only. */
function bodyOf(markdown: string): string {
  return markdown.replace(/^```\w+\n/, "").replace(/\n```$/, "");
}

describe("videoFenceMarkdown", () => {
  it("wraps the reference in a video fence", () => {
    const markdown = videoFenceMarkdown("A kite in a gale", URL);

    expect(markdown.startsWith("```" + VIDEO_FENCE_LANGUAGE + "\n")).toBe(true);
    expect(markdown.endsWith("\n```")).toBe(true);
    expect(parseVideoFence(bodyOf(markdown))).toEqual({
      url: URL,
      title: "A kite in a gale",
    });
  });

  it("survives a prompt that would break out of a markdown image", () => {
    // The reason the body is JSON: brackets, backticks, quotes and newlines in
    // a prompt are all just text inside it.
    const prompt = 'A logo reading "[ACME]" — with `ticks` and "quotes"\non two lines';
    const parsed = parseVideoFence(bodyOf(videoFenceMarkdown(prompt, URL)));

    expect(parsed?.url).toBe(URL);
    expect(parsed?.title).toContain('"[ACME]"');
  });

  it("leaves no title when the prompt has nothing in it", () => {
    for (const prompt of ["", "   ", "\n"]) {
      expect(parseVideoFence(bodyOf(videoFenceMarkdown(prompt, URL)))).toEqual({
        url: URL,
      });
    }
  });

  it("collapses the title onto one line and caps it", () => {
    const parsed = parseVideoFence(
      bodyOf(videoFenceMarkdown("  a\n\nb   c  ", URL)),
    );
    const long = parseVideoFence(bodyOf(videoFenceMarkdown("x".repeat(300), URL)));

    expect(parsed?.title).toBe("a b c");
    expect(long?.title).toHaveLength(120);
  });
});

describe("parseVideoFence", () => {
  it("rejects a body that is not a usable reference", () => {
    expect(parseVideoFence("")).toBeNull();
    expect(parseVideoFence("   ")).toBeNull();
    expect(parseVideoFence("not json")).toBeNull();
    expect(parseVideoFence("{")).toBeNull();
    expect(parseVideoFence("null")).toBeNull();
    expect(parseVideoFence("[]")).toBeNull();
    expect(parseVideoFence('"https://example.com/a.mp4"')).toBeNull();
    expect(parseVideoFence("{}")).toBeNull();
    expect(parseVideoFence('{"url": ""}')).toBeNull();
    expect(parseVideoFence('{"url": 42}')).toBeNull();
  });

  it("accepts a reference with no title", () => {
    expect(parseVideoFence(`{"url": "${URL}"}`)).toEqual({ url: URL });
  });

  it("ignores a title that is not usable text", () => {
    expect(parseVideoFence(`{"url": "${URL}", "title": ""}`)).toEqual({ url: URL });
    expect(parseVideoFence(`{"url": "${URL}", "title": 7}`)).toEqual({ url: URL });
  });

  it("accepts an absolute URL as well as the proxy path", () => {
    // Nothing here assumes the proxy: the fence is a reference, and a thread
    // written against a different deployment still has to render.
    expect(parseVideoFence('{"url": "https://example.com/a.mp4"}')?.url).toBe(
      "https://example.com/a.mp4",
    );
  });
});
