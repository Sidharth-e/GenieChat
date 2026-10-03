import { describe, it, expect } from "vitest";
import {
  SCANCODE_FORMATS,
  SCANCODE_FORMAT_LABELS,
  SCANCODE_FILENAME_MAX_LENGTH,
  SCANCODE_TITLE_MAX_LENGTH,
  parseScancodeConfig,
  buildScancodeOptions,
  isLinearScancodeFormat,
  scancodeFileName,
  scancodeTitle,
  extractScancodeFences,
  withIntrinsicSize,
} from "@/lib/scancode";
import type { ScancodeConfig } from "@/lib/types";

function configFactory(overrides: Partial<ScancodeConfig> = {}): ScancodeConfig {
  return {
    format: "qrcode",
    text: "https://example.com",
    ...overrides,
  };
}

describe("SCANCODE_FORMATS", () => {
  it("lists the formats the fence accepts", () => {
    expect(SCANCODE_FORMATS).toContain("qrcode");
    expect(SCANCODE_FORMATS).toContain("code128");
    expect(SCANCODE_FORMATS).toContain("ean13");
    expect(SCANCODE_FORMATS).toContain("upca");
    expect(SCANCODE_FORMATS).toContain("code39");
    expect(SCANCODE_FORMATS).toContain("datamatrix");
  });
});

describe("SCANCODE_FORMAT_LABELS", () => {
  it("names every accepted format", () => {
    for (const format of SCANCODE_FORMATS) {
      expect(SCANCODE_FORMAT_LABELS[format]).toBeTruthy();
    }
    expect(SCANCODE_FORMAT_LABELS.qrcode).toBe("QR Code");
    expect(SCANCODE_FORMAT_LABELS.ean13).toBe("EAN-13");
  });
});

describe("isLinearScancodeFormat", () => {
  it("treats the 2D formats as non-linear", () => {
    expect(isLinearScancodeFormat("qrcode")).toBe(false);
    expect(isLinearScancodeFormat("datamatrix")).toBe(false);
  });

  it("treats the bar formats as linear", () => {
    expect(isLinearScancodeFormat("code128")).toBe(true);
    expect(isLinearScancodeFormat("ean13")).toBe(true);
    expect(isLinearScancodeFormat("upca")).toBe(true);
    expect(isLinearScancodeFormat("code39")).toBe(true);
  });
});

describe("parseScancodeConfig", () => {
  it("returns null for an empty string", () => {
    expect(parseScancodeConfig("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseScancodeConfig("{ not json")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(parseScancodeConfig('["qrcode"]')).toBeNull();
  });

  it("returns null for JSON scalars", () => {
    expect(parseScancodeConfig("null")).toBeNull();
    expect(parseScancodeConfig('"qrcode"')).toBeNull();
    expect(parseScancodeConfig("42")).toBeNull();
  });

  it("returns null when format is missing", () => {
    expect(parseScancodeConfig('{"text":"hello"}')).toBeNull();
  });

  it("returns null when format is unknown", () => {
    expect(parseScancodeConfig('{"format":"pdf417","text":"hi"}')).toBeNull();
  });

  it("returns null when text is missing, non-string or blank", () => {
    expect(parseScancodeConfig('{"format":"qrcode"}')).toBeNull();
    expect(parseScancodeConfig('{"format":"qrcode","text":7}')).toBeNull();
    expect(parseScancodeConfig('{"format":"qrcode","text":""}')).toBeNull();
    expect(parseScancodeConfig('{"format":"qrcode","text":"   "}')).toBeNull();
  });

  it("parses a minimal config", () => {
    expect(parseScancodeConfig('{"format":"qrcode","text":"hi"}')).toEqual({
      format: "qrcode",
      text: "hi",
    });
  });

  it("normalizes format casing and surrounding whitespace", () => {
    expect(
      parseScancodeConfig('{"format":" QRCode ","text":"hi"}')?.format,
    ).toBe("qrcode");
  });

  it("keeps a string caption and drops a non-string one", () => {
    expect(
      parseScancodeConfig('{"format":"qrcode","text":"hi","caption":"Scan"}')
        ?.caption,
    ).toBe("Scan");
    expect(
      parseScancodeConfig('{"format":"qrcode","text":"hi","caption":9}')?.caption,
    ).toBeUndefined();
  });

  it("keeps numeric scale and includeText, dropping wrong types", () => {
    const parsed = parseScancodeConfig(
      '{"format":"code128","text":"hi","scale":3,"includeText":false}',
    );
    expect(parsed?.scale).toBe(3);
    expect(parsed?.includeText).toBe(false);

    const dropped = parseScancodeConfig(
      '{"format":"code128","text":"hi","scale":"3","includeText":"no"}',
    );
    expect(dropped?.scale).toBeUndefined();
    expect(dropped?.includeText).toBeUndefined();
  });

  it("keeps a finite numeric height and drops a non-finite one", () => {
    expect(
      parseScancodeConfig('{"format":"code128","text":"hi","height":20}')?.height,
    ).toBe(20);
    expect(
      parseScancodeConfig('{"format":"code128","text":"hi","height":"20"}')
        ?.height,
    ).toBeUndefined();
  });
});

describe("buildScancodeOptions", () => {
  it("maps the format to the bwip-js symbol name", () => {
    expect(buildScancodeOptions(configFactory()).bcid).toBe("qrcode");
    expect(buildScancodeOptions(configFactory({ format: "ean13" })).bcid).toBe(
      "ean13",
    );
  });

  it("forces a white background so the code scans in dark mode", () => {
    expect(buildScancodeOptions(configFactory()).backgroundcolor).toBe("FFFFFF");
    expect(
      buildScancodeOptions(configFactory({ format: "code128" })).backgroundcolor,
    ).toBe("FFFFFF");
  });

  it("defaults the scale to 2", () => {
    expect(buildScancodeOptions(configFactory()).scale).toBe(2);
  });

  it("rounds a fractional scale and clamps it into range", () => {
    expect(buildScancodeOptions(configFactory({ scale: 2.5 })).scale).toBe(3);
    expect(buildScancodeOptions(configFactory({ scale: 0 })).scale).toBe(1);
    expect(buildScancodeOptions(configFactory({ scale: 99 })).scale).toBe(6);
  });

  it("omits the linear-only options for the 2D formats", () => {
    const options = buildScancodeOptions(configFactory());
    expect(options).not.toHaveProperty("height");
    expect(options).not.toHaveProperty("includetext");
    expect(
      buildScancodeOptions(configFactory({ format: "datamatrix" })),
    ).not.toHaveProperty("height");
  });

  it("gives linear formats a default height and bars text", () => {
    const options = buildScancodeOptions(configFactory({ format: "code128" }));
    expect(options.height).toBe(15);
    expect(options.includetext).toBe(true);
    expect(options.textxalign).toBe("center");
  });

  it("honours an explicit height and a disabled text bar", () => {
    const options = buildScancodeOptions(
      configFactory({ format: "code128", height: 22, includeText: false }),
    );
    expect(options.height).toBe(22);
    expect(options.includetext).toBe(false);
  });

  it("clamps an out-of-range height", () => {
    expect(
      buildScancodeOptions(configFactory({ format: "code128", height: 500 }))
        .height,
    ).toBe(50);
    expect(
      buildScancodeOptions(configFactory({ format: "code128", height: 0 }))
        .height,
    ).toBe(5);
  });

  it("always carries the text through", () => {
    expect(buildScancodeOptions(configFactory({ text: "ABC-123" })).text).toBe(
      "ABC-123",
    );
  });
});

describe("scancodeFileName", () => {
  it("names a file for its format and its payload", () => {
    expect(scancodeFileName(configFactory())).toBe("qrcode-example-com.svg");
    expect(
      scancodeFileName(configFactory({ format: "ean13", text: "590123412345" })),
    ).toBe("ean13-590123412345.svg");
  });

  it("drops the scheme, which is transport rather than payload", () => {
    expect(scancodeFileName(configFactory({ text: "http://example.com/a" }))).toBe(
      "qrcode-example-com-a.svg",
    );
    expect(
      scancodeFileName(configFactory({ text: "mailto:ada@example.com" })),
    ).toBe("qrcode-ada-example-com.svg");
    expect(scancodeFileName(configFactory({ text: "tel:+15550100" }))).toBe(
      "qrcode-15550100.svg",
    );
  });

  it("lowercases and collapses runs of punctuation", () => {
    expect(
      scancodeFileName(configFactory({ format: "code128", text: "SKU--4471 / A" })),
    ).toBe("code128-sku-4471-a.svg");
  });

  it("never leaves a leading or trailing dash", () => {
    expect(scancodeFileName(configFactory({ text: "  ???hello???  " }))).toBe(
      "qrcode-hello.svg",
    );
    expect(scancodeFileName(configFactory({ text: "Café" }))).toBe(
      "qrcode-caf.svg",
    );
  });

  it("falls back to the bare format when nothing survives", () => {
    expect(scancodeFileName(configFactory({ text: "///" }))).toBe("qrcode.svg");
  });

  it("caps a long payload without leaving a trailing dash", () => {
    const name = scancodeFileName(configFactory({ text: "a".repeat(200) }));
    expect(name).toBe(`qrcode-${"a".repeat(SCANCODE_FILENAME_MAX_LENGTH)}.svg`);

    const dashed = scancodeFileName(
      configFactory({ text: `${"a".repeat(63)}-${"b".repeat(20)}` }),
    );
    expect(dashed.endsWith("-")).toBe(false);
  });
});

describe("scancodeTitle", () => {
  it("names the format before the payload", () => {
    expect(scancodeTitle(configFactory())).toBe("QR Code — https://example.com");
    expect(
      scancodeTitle(configFactory({ format: "datamatrix", text: "LOT-9" })),
    ).toBe("Data Matrix — LOT-9");
  });

  it("folds a multi-line payload onto one line", () => {
    expect(
      scancodeTitle(configFactory({ text: "BEGIN:VCARD\nFN:Ada\nEND:VCARD" })),
    ).toBe("QR Code — BEGIN:VCARD FN:Ada END:VCARD");
  });

  it("caps a long payload with an ellipsis", () => {
    const title = scancodeTitle(configFactory({ text: "x".repeat(300) }));
    expect(title.length).toBe(SCANCODE_TITLE_MAX_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("extractScancodeFences", () => {
  it("returns the body of a single complete fence", () => {
    expect(
      extractScancodeFences('Here:\n```scancode\n{"format":"qrcode"}\n```\nDone.'),
    ).toEqual(['{"format":"qrcode"}']);
  });

  it("returns every fence in the message", () => {
    const text = [
      "```scancode",
      "one",
      "```",
      "prose between",
      "```scancode",
      "two",
      "```",
    ].join("\n");
    expect(extractScancodeFences(text)).toEqual(["one", "two"]);
  });

  it("ignores a fence that is still being written", () => {
    expect(extractScancodeFences('```scancode\n{"format":"qrcode"}')).toEqual([]);
  });

  it("ignores other languages", () => {
    expect(
      extractScancodeFences('```json\n{"format":"qrcode"}\n```'),
    ).toEqual([]);
  });

  it("ignores a fence shown inside another fence", () => {
    const text = ["````markdown", "```scancode", "{}", "```", "````"].join("\n");
    expect(extractScancodeFences(text)).toEqual([]);
  });

  it("accepts a tilde fence", () => {
    expect(extractScancodeFences("~~~scancode\n{}\n~~~")).toEqual(["{}"]);
  });

  it("does not let one marker close another", () => {
    expect(extractScancodeFences("~~~scancode\n{}\n```")).toEqual([]);
  });

  it("requires a closer at least as long as the opener", () => {
    expect(extractScancodeFences("````scancode\n{}\n```")).toEqual([]);
    expect(extractScancodeFences("````scancode\n{}\n````")).toEqual(["{}"]);
  });

  it("does not close on a fence that carries an info string", () => {
    expect(extractScancodeFences("```scancode\n{}\n```js")).toEqual([]);
  });

  it("accepts a fence indented up to three spaces", () => {
    expect(extractScancodeFences("   ```scancode\n{}\n   ```")).toEqual(["{}"]);
  });

  it("does not treat a four-space indent as a fence", () => {
    expect(extractScancodeFences("    ```scancode\n{}\n    ```")).toEqual([]);
  });

  it("matches the language the renderer matches", () => {
    expect(extractScancodeFences("```SCANCODE\n{}\n```")).toEqual([]);
  });

  it("still accepts the fence's former name", () => {
    expect(extractScancodeFences("```barcode\n{}\n```")).toEqual(["{}"]);
    expect(extractScancodeFences("~~~BARCODE\n{}\n~~~")).toEqual([]);
  });

  it("does not match a language that merely starts with one of them", () => {
    expect(extractScancodeFences("```barcodes\n{}\n```")).toEqual([]);
    expect(extractScancodeFences("```scancodes\n{}\n```")).toEqual([]);
  });

  it("keeps a multi-line body intact", () => {
    expect(extractScancodeFences("```scancode\n{\n  \"a\": 1\n}\n```")).toEqual([
      '{\n  "a": 1\n}',
    ]);
  });

  it("returns nothing for a message with no fence", () => {
    expect(extractScancodeFences("just prose")).toEqual([]);
    expect(extractScancodeFences("")).toEqual([]);
  });
});

describe("withIntrinsicSize", () => {
  const svg = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">';

  it("takes its size from the viewBox", () => {
    const sized = withIntrinsicSize(svg);
    expect(sized).toContain('width="100"');
    expect(sized).toContain('height="100"');
  });

  it("keeps the viewBox so the symbol still scales", () => {
    expect(withIntrinsicSize(svg)).toContain('viewBox="0 0 100 100"');
  });

  it("lets a narrow container shrink it instead of clipping it", () => {
    expect(withIntrinsicSize(svg)).toContain("max-width:100%");
  });

  it("keeps the other attributes on the opening tag", () => {
    expect(withIntrinsicSize(svg)).toContain(
      'xmlns="http://www.w3.org/2000/svg"',
    );
  });

  it("handles a non-square viewBox, which is what the linear formats emit", () => {
    const sized = withIntrinsicSize('<svg viewBox="0 0 224 102">');
    expect(sized).toContain('width="224"');
    expect(sized).toContain('height="102"');
  });

  it("leaves the rest of the document untouched", () => {
    const body = `${svg}<path d="M0 1"/>`;
    expect(withIntrinsicSize(body)).toContain('<path d="M0 1"/>');
  });

  it("returns the input unchanged when there is no viewBox to read", () => {
    const bare = '<svg xmlns="http://www.w3.org/2000/svg">';
    expect(withIntrinsicSize(bare)).toBe(bare);
  });

  it("returns the input unchanged when it is not an svg at all", () => {
    expect(withIntrinsicSize("not an svg")).toBe("not an svg");
  });
});
