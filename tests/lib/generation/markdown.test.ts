import { describe, expect, it } from "vitest";

import { markdownImageFor } from "@/lib/generation/markdown";

const URL = "/api/storage/download?ref=s3%3A%2F%2Fgenerated-images%2Fu1%2Fa.png";

describe("markdownImageFor", () => {
  it("uses the prompt as the alt text", () => {
    expect(markdownImageFor("a red panda astronaut", URL)).toBe(
      `![a red panda astronaut](${URL})`,
    );
  });

  it("keeps a bracket in the prompt from closing the alt text early", () => {
    const markdown = markdownImageFor("a logo reading [ACME]", URL);

    expect(markdown).toBe(`![a logo reading ACME](${URL})`);
    expect(markdown.match(/\]/g)).toHaveLength(1);
  });

  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(markdownImageFor("a fox\nreading   a book", URL)).toBe(
      `![a fox reading a book](${URL})`,
    );
  });

  it("drops backslashes that could escape the closing bracket", () => {
    expect(markdownImageFor("a fox \\] on a log", URL)).toBe(
      `![a fox on a log](${URL})`,
    );
  });

  it("falls back to a generic alt when the prompt leaves nothing behind", () => {
    expect(markdownImageFor("[][]", URL)).toBe(`![Generated image](${URL})`);
    expect(markdownImageFor("   ", URL)).toBe(`![Generated image](${URL})`);
  });

  it("bounds a very long prompt", () => {
    const markdown = markdownImageFor("x".repeat(500), URL);
    const alt = markdown.slice(2, markdown.indexOf("]("));

    expect(alt).toHaveLength(120);
  });
});
