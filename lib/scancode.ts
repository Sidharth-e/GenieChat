import type {
  ScancodeConfig,
  ScancodeFormat,
  ScancodeOptions,
} from "@/lib/types";

const FORMATS = [
  "qrcode",
  "datamatrix",
  "code128",
  "ean13",
  "upca",
  "code39",
] as const;

/**
 * The ```` ```scancode ```` fence's accepted `format` values. Named here rather
 * than derived from a library so the fence contract and the prompt copy cannot
 * drift from each other.
 *
 * "Scan code" rather than "barcode" because the fence covers both: a QR is a
 * matrix, not a barcode, and the two are different symbologies with different
 * payload rules.
 */
export const SCANCODE_FORMATS: readonly ScancodeFormat[] = FORMATS;

const FORMAT_SET = new Set<string>(FORMATS);

/** How each format is named to a reader. Shared by the card and the artifact. */
export const SCANCODE_FORMAT_LABELS: Record<ScancodeFormat, string> = {
  qrcode: "QR Code",
  datamatrix: "Data Matrix",
  code128: "Code 128",
  ean13: "EAN-13",
  upca: "UPC-A",
  code39: "Code 39",
};

const LINEAR_FORMATS = new Set<ScancodeFormat>([
  "code128",
  "ean13",
  "upca",
  "code39",
]);

/** bwip-js requires an integer scale > 0; these are the bounds we hand it. */
export const SCANCODE_SCALE_MIN = 1;
export const SCANCODE_SCALE_MAX = 6;
export const DEFAULT_SCANCODE_SCALE = 2;

/** BWIPP reads a linear symbol's height in millimetres. */
export const SCANCODE_HEIGHT_MIN = 5;
export const SCANCODE_HEIGHT_MAX = 50;
export const DEFAULT_SCANCODE_HEIGHT = 15;

/** How much of the payload is kept in a file name, and in an artifact title. */
export const SCANCODE_FILENAME_MAX_LENGTH = 64;
export const SCANCODE_TITLE_MAX_LENGTH = 120;

/**
 * Whether the format draws bars rather than a matrix. Linear symbols take a
 * height and can carry a human-readable text bar; 2D ones cannot.
 */
export function isLinearScancodeFormat(format: ScancodeFormat): boolean {
  return LINEAR_FORMATS.has(format);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse a ```` ```scancode ```` fence body into a config, or null when it is not
 * one. A null result means "not a usable fence yet" — mid-stream the fence is
 * still arriving, and once the stream ends it is a malformed config — so the
 * renderer, not this function, decides which of those two to show.
 */
export function parseScancodeConfig(content: string): ScancodeConfig | null {
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

  const config: ScancodeConfig = {
    format: format as ScancodeFormat,
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
 * The background is pinned white: a scan code is a machine-read symbol, and an
 * inverted one fails on many scanners, so this stays light even in dark mode.
 * The quiet zone scanners need comes from the renderer's white padding, which
 * keeps it in CSS pixels instead of BWIPP's points.
 */
export function buildScancodeOptions(config: ScancodeConfig): ScancodeOptions {
  const options: ScancodeOptions = {
    bcid: config.format,
    text: config.text,
    scale: Math.round(
      clamp(
        config.scale ?? DEFAULT_SCANCODE_SCALE,
        SCANCODE_SCALE_MIN,
        SCANCODE_SCALE_MAX,
      ),
    ),
    backgroundcolor: "FFFFFF",
  };

  if (isLinearScancodeFormat(config.format)) {
    options.height = clamp(
      config.height ?? DEFAULT_SCANCODE_HEIGHT,
      SCANCODE_HEIGHT_MIN,
      SCANCODE_HEIGHT_MAX,
    );
    options.includetext = config.includeText ?? true;
    options.textxalign = "center";
  }

  return options;
}

/**
 * A leading scheme is transport, not payload, so it is dropped before the name
 * is built: a QR of a URL is named for the resource it points at, not for
 * `https`.
 */
const SCHEME_PREFIX = /^(?:https?|ftp|mailto|tel|sms):(?:\/\/)?/i;

/**
 * The name a downloaded symbol is saved under.
 *
 * The format leads, because a scan code is a symbology plus a payload and the
 * file should say which: `qrcode-example-com.svg` and
 * `ean13-590123412345.svg` are not interchangeable, and a bare `barcode.svg`
 * would misname the QR. Everything that is not a letter or a digit collapses to
 * a single dash, so a URL, a vCard or a SKU all survive as one path-safe token.
 */
export function scancodeFileName(config: ScancodeConfig): string {
  const slug = config.text
    .replace(SCHEME_PREFIX, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const capped = slug
    .slice(0, SCANCODE_FILENAME_MAX_LENGTH)
    .replace(/-+$/g, "");

  return capped ? `${config.format}-${capped}.svg` : `${config.format}.svg`;
}

/**
 * How a saved symbol is titled in the Artifacts list: the format a reader
 * recognises, then the payload it carries. Newlines are folded because a QR
 * payload is often a vCard, and a title is one line.
 */
export function scancodeTitle(config: ScancodeConfig): string {
  const label = SCANCODE_FORMAT_LABELS[config.format];
  const payload = config.text.replace(/\s+/g, " ").trim();
  const title = `${label} — ${payload}`;

  return title.length > SCANCODE_TITLE_MAX_LENGTH
    ? `${title.slice(0, SCANCODE_TITLE_MAX_LENGTH - 1)}…`
    : title;
}

/**
 * A fence opener or closer. Up to three leading spaces, per CommonMark, and an
 * info string that a backtick fence may not contain a backtick in.
 */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/**
 * `barcode` is the fence's former name and is still accepted.
 *
 * Renaming the fence in `constants/prompt.ts` only changes what the model is
 * told from now on. It does not rewrite the threads already on disk, and it does
 * not rewrite the earlier turns of the conversation the model is currently
 * reading — so a model that sees its own past `barcode` fences goes on emitting
 * them, and those messages would render as raw JSON rather than a symbol.
 */
const SCANCODE_INFO = /^[ \t]*(?:scancode|barcode)(?:[ \t]|$)/;

/**
 * The bodies of every **complete** ```` ```scancode ```` fence in a message.
 *
 * Completeness is the point: this runs on a finished stream, and an unterminated
 * fence is one the model was still writing. Returning it would persist half a
 * payload as an artifact.
 *
 * A closer must use the opener's own marker and be at least as long, so a
 * ```` ``` ```` inside a `~~~` block is content — which is what lets the model
 * show a fence example inside a fence.
 */
export function extractScancodeFences(text: string): string[] {
  // Called once per stream. Most messages hold no fence at all, and this saves
  // splitting every one of them into lines. Both names, because the fast path
  // has to admit everything the scan below would accept.
  if (!text.includes("scancode") && !text.includes("barcode")) {
    return [];
  }

  const bodies: string[] = [];
  const lines = text.split("\n");

  let openMarker: string | null = null;
  let openLength = 0;
  let isScancode = false;
  let buffer: string[] = [];

  for (const line of lines) {
    if (openMarker === null) {
      const opener = FENCE_LINE.exec(line);
      if (!opener) {
        continue;
      }
      const marker = opener[1];
      if (marker[0] === "`" && opener[2].includes("`")) {
        continue;
      }
      openMarker = marker[0];
      openLength = marker.length;
      isScancode = SCANCODE_INFO.test(opener[2]);
      buffer = [];
      continue;
    }

    const closer = new RegExp(
      `^ {0,3}\\${openMarker}{${openLength},}[ \\t]*$`,
    );
    if (closer.test(line)) {
      if (isScancode) {
        bodies.push(buffer.join("\n"));
      }
      openMarker = null;
      isScancode = false;
      buffer = [];
      continue;
    }

    if (isScancode) {
      buffer.push(line);
    }
  }

  return bodies;
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
