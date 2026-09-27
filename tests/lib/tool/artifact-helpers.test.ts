import { describe, it, expect } from "vitest";
import { createArtifactPayload } from "@/lib/tool/artifact-helpers";

describe("createArtifactPayload", () => {
  it("builds a payload from the tool arguments", () => {
    expect(createArtifactPayload("chart", "Revenue", '{"a":1}', "json")).toEqual({
      type: "chart",
      title: "Revenue",
      content: '{"a":1}',
      ext: "json",
    });
  });

  it("carries metadata through when given", () => {
    const metadata = { width: 640 };

    expect(
      createArtifactPayload("image", "Logo", "<svg/>", "svg", metadata),
    ).toEqual({
      type: "image",
      title: "Logo",
      content: "<svg/>",
      ext: "svg",
      metadata,
    });
  });
});
