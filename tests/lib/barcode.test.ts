import { describe, it, expect } from "vitest";
import {
  BARCODE_FORMATS,
  parseBarcodeConfig,
  buildBarcodeOptions,
  isLinearBarcodeFormat,
} from "@/lib/barcode";
import type { BarcodeConfig } from "@/lib/types";

function configFactory(overrides: Partial<BarcodeConfig> = {}): BarcodeConfig {
  return {
    format: "qrcode",
    text: "https://example.com",
    ...overrides,
  };
}

describe("BARCODE_FORMATS", () => {
  it("lists the formats the fence accepts", () => {
    expect(BARCODE_FORMATS).toContain("qrcode");
    expect(BARCODE_FORMATS).toContain("code128");
    expect(BARCODE_FORMATS).toContain("ean13");
    expect(BARCODE_FORMATS).toContain("upca");
    expect(BARCODE_FORMATS).toContain("code39");
    expect(BARCODE_FORMATS).toContain("datamatrix");
  });
});

describe("isLinearBarcodeFormat", () => {
  it("treats the 2D formats as non-linear", () => {
    expect(isLinearBarcodeFormat("qrcode")).toBe(false);
    expect(isLinearBarcodeFormat("datamatrix")).toBe(false);
  });

  it("treats the bar formats as linear", () => {
    expect(isLinearBarcodeFormat("code128")).toBe(true);
    expect(isLinearBarcodeFormat("ean13")).toBe(true);
    expect(isLinearBarcodeFormat("upca")).toBe(true);
    expect(isLinearBarcodeFormat("code39")).toBe(true);
  });
});

describe("parseBarcodeConfig", () => {
  it("returns null for an empty string", () => {
    expect(parseBarcodeConfig("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseBarcodeConfig("{ not json")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(parseBarcodeConfig('["qrcode"]')).toBeNull();
  });

  it("returns null for JSON scalars", () => {
    expect(parseBarcodeConfig("null")).toBeNull();
    expect(parseBarcodeConfig('"qrcode"')).toBeNull();
    expect(parseBarcodeConfig("42")).toBeNull();
  });

  it("returns null when format is missing", () => {
    expect(parseBarcodeConfig('{"text":"hello"}')).toBeNull();
  });

  it("returns null when format is unknown", () => {
    expect(parseBarcodeConfig('{"format":"pdf417","text":"hi"}')).toBeNull();
  });

  it("returns null when text is missing, non-string or blank", () => {
    expect(parseBarcodeConfig('{"format":"qrcode"}')).toBeNull();
    expect(parseBarcodeConfig('{"format":"qrcode","text":7}')).toBeNull();
    expect(parseBarcodeConfig('{"format":"qrcode","text":""}')).toBeNull();
    expect(parseBarcodeConfig('{"format":"qrcode","text":"   "}')).toBeNull();
  });

  it("parses a minimal config", () => {
    expect(parseBarcodeConfig('{"format":"qrcode","text":"hi"}')).toEqual({
      format: "qrcode",
      text: "hi",
    });
  });

  it("normalizes format casing and surrounding whitespace", () => {
    expect(parseBarcodeConfig('{"format":" QRCode ","text":"hi"}')?.format).toBe(
      "qrcode",
    );
  });

  it("keeps a string caption and drops a non-string one", () => {
    expect(
      parseBarcodeConfig('{"format":"qrcode","text":"hi","caption":"Scan"}')
        ?.caption,
    ).toBe("Scan");
    expect(
      parseBarcodeConfig('{"format":"qrcode","text":"hi","caption":9}')?.caption,
    ).toBeUndefined();
  });

  it("keeps numeric scale and includeText, dropping wrong types", () => {
    const parsed = parseBarcodeConfig(
      '{"format":"code128","text":"hi","scale":3,"includeText":false}',
    );
    expect(parsed?.scale).toBe(3);
    expect(parsed?.includeText).toBe(false);

    const dropped = parseBarcodeConfig(
      '{"format":"code128","text":"hi","scale":"3","includeText":"no"}',
    );
    expect(dropped?.scale).toBeUndefined();
    expect(dropped?.includeText).toBeUndefined();
  });

  it("keeps a finite numeric height and drops a non-finite one", () => {
    expect(
      parseBarcodeConfig('{"format":"code128","text":"hi","height":20}')?.height,
    ).toBe(20);
    expect(
      parseBarcodeConfig('{"format":"code128","text":"hi","height":"20"}')
        ?.height,
    ).toBeUndefined();
  });
});

describe("buildBarcodeOptions", () => {
  it("maps the format to the bwip-js symbol name", () => {
    expect(buildBarcodeOptions(configFactory()).bcid).toBe("qrcode");
    expect(buildBarcodeOptions(configFactory({ format: "ean13" })).bcid).toBe(
      "ean13",
    );
  });

  it("forces a white background so the code scans in dark mode", () => {
    expect(buildBarcodeOptions(configFactory()).backgroundcolor).toBe("FFFFFF");
    expect(
      buildBarcodeOptions(configFactory({ format: "code128" })).backgroundcolor,
    ).toBe("FFFFFF");
  });

  it("defaults the scale to 2", () => {
    expect(buildBarcodeOptions(configFactory()).scale).toBe(2);
  });

  it("rounds a fractional scale and clamps it into range", () => {
    expect(buildBarcodeOptions(configFactory({ scale: 2.5 })).scale).toBe(3);
    expect(buildBarcodeOptions(configFactory({ scale: 0 })).scale).toBe(1);
    expect(buildBarcodeOptions(configFactory({ scale: 99 })).scale).toBe(6);
  });

  it("omits the linear-only options for the 2D formats", () => {
    const options = buildBarcodeOptions(configFactory());
    expect(options).not.toHaveProperty("height");
    expect(options).not.toHaveProperty("includetext");
    expect(buildBarcodeOptions(configFactory({ format: "datamatrix" }))).not.toHaveProperty(
      "height",
    );
  });

  it("gives linear formats a default height and bars text", () => {
    const options = buildBarcodeOptions(configFactory({ format: "code128" }));
    expect(options.height).toBe(15);
    expect(options.includetext).toBe(true);
    expect(options.textxalign).toBe("center");
  });

  it("honours an explicit height and a disabled text bar", () => {
    const options = buildBarcodeOptions(
      configFactory({ format: "code128", height: 22, includeText: false }),
    );
    expect(options.height).toBe(22);
    expect(options.includetext).toBe(false);
  });

  it("clamps an out-of-range height", () => {
    expect(
      buildBarcodeOptions(configFactory({ format: "code128", height: 500 }))
        .height,
    ).toBe(50);
    expect(
      buildBarcodeOptions(configFactory({ format: "code128", height: 0 })).height,
    ).toBe(5);
  });

  it("always carries the text through", () => {
    expect(buildBarcodeOptions(configFactory({ text: "ABC-123" })).text).toBe(
      "ABC-123",
    );
  });
});
