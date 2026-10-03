import type { BarcodeConfig, BarcodeFormat, BarcodeOptions } from "@/lib/types";

const FORMATS = [
  "qrcode",
  "datamatrix",
  "code128",
  "ean13",
  "upca",
  "code39",
] as const;

/**
 * The ```` ```barcode ```` fence's accepted `format` values. Named here rather
 * than derived from a library so the fence contract and the prompt copy cannot
 * drift from each other.
 */
export const BARCODE_FORMATS: readonly BarcodeFormat[] = FORMATS;

const FORMAT_SET = new Set<string>(FORMATS);

const LINEAR_FORMATS = new Set<BarcodeFormat>([
  "code128",
  "ean13",
  "upca",
  "code39",
]);

/** bwip-js requires an integer scale > 0; these are the bounds we hand it. */
export const BARCODE_SCALE_MIN = 1;
export const BARCODE_SCALE_MAX = 6;
export const DEFAULT_BARCODE_SCALE = 2;

/** BWIPP reads a linear symbol's height in millimetres. */
export const BARCODE_HEIGHT_MIN = 5;
export const BARCODE_HEIGHT_MAX = 50;
export const DEFAULT_BARCODE_HEIGHT = 15;

/**
 * Whether the format draws bars rather than a matrix. Linear symbols take a
 * height and can carry a human-readable text bar; 2D ones cannot.
 */
export function isLinearBarcodeFormat(format: BarcodeFormat): boolean {
  return LINEAR_FORMATS.has(format);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse a ```` ```barcode ```` fence body into a config, or null when it is not
 * one. A null result means "not a usable fence yet" — mid-stream the fence is
 * still arriving, and once the stream ends it is a malformed config — so the
 * renderer, not this function, decides which of those two to show.
 */
export function parseBarcodeConfig(content: string): BarcodeConfig | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.format !== "string") {
    return null;
  }
  const format = record.format.trim().toLowerCase();
  if (!FORMAT_SET.has(format)) {
    return null;
  }

  if (typeof record.text !== "string" || record.text.trim() === "") {
    return null;
  }

  const config: BarcodeConfig = {
    format: format as BarcodeFormat,
    text: record.text,
  };

  if (typeof record.caption === "string" && record.caption.trim() !== "") {
    config.caption = record.caption;
  }
  if (typeof record.scale === "number" && Number.isFinite(record.scale)) {
    config.scale = record.scale;
  }
  if (typeof record.height === "number" && Number.isFinite(record.height)) {
    config.height = record.height;
  }
  if (typeof record.includeText === "boolean") {
    config.includeText = record.includeText;
  }

  return config;
}

/**
 * Map a parsed config onto a bwip-js options object. The 2D formats take none
 * of the linear-only options, so they are added only when they apply rather
 * than passed as nulls.
 *
 * The background is pinned white: a barcode is a machine-read symbol, and an
 * inverted code fails on many scanners, so this stays light even in dark mode.
 * The quiet zone scanners need comes from the renderer's white padding, which
 * keeps it in CSS pixels instead of BWIPP's points.
 */
export function buildBarcodeOptions(config: BarcodeConfig): BarcodeOptions {
  const options: BarcodeOptions = {
    bcid: config.format,
    text: config.text,
    scale: Math.round(
      clamp(
        config.scale ?? DEFAULT_BARCODE_SCALE,
        BARCODE_SCALE_MIN,
        BARCODE_SCALE_MAX,
      ),
    ),
    backgroundcolor: "FFFFFF",
  };

  if (isLinearBarcodeFormat(config.format)) {
    options.height = clamp(
      config.height ?? DEFAULT_BARCODE_HEIGHT,
      BARCODE_HEIGHT_MIN,
      BARCODE_HEIGHT_MAX,
    );
    options.includetext = config.includeText ?? true;
    options.textxalign = "center";
  }

  return options;
}

const SVG_OPEN_TAG = /^<svg\b[^>]*>/;
const SVG_VIEW_BOX = /\bviewBox="0 0 ([\d.]+) ([\d.]+)"/;

/**
 * Give a bwip-js SVG the intrinsic size it does not ship with.
 *
 * `toSVG` emits a bare `<svg viewBox="0 0 W H">` — no `width`, no `height` — so
 * the symbol has no intrinsic size and is laid out at whatever the surrounding
 * box happens to give it. In practice that ranges from filling the card and
 * being clipped by its `overflow-hidden` to collapsing to nothing, depending on
 * the parent. Setting the viewBox's own dimensions makes the rendered size
 * equal the scale knob the fence already exposes, and `max-width` lets it
 * shrink rather than clip on a narrow screen.
 *
 * Returns the input unchanged if it is not a bwip-js SVG. `toSVG` always emits
 * a viewBox, so that is a guard against a future format rather than a case the
 * fence can reach.
 */
export function withIntrinsicSize(svg: string): string {
  const openTag = SVG_OPEN_TAG.exec(svg);
  if (!openTag) {
    return svg;
  }

  const viewBox = SVG_VIEW_BOX.exec(openTag[0]);
  if (!viewBox) {
    return svg;
  }

  const [, width, height] = viewBox;
  const sizedTag = openTag[0].replace(
    "<svg",
    `<svg width="${width}" height="${height}" style="max-width:100%;height:auto;display:block"`,
  );

  return svg.replace(openTag[0], sizedTag);
}
