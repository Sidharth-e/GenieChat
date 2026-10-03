"use client";

import * as React from "react";
import { toSVG } from "bwip-js/browser";

import {
  BARCODE_FORMATS,
  buildBarcodeOptions,
  parseBarcodeConfig,
} from "@/lib/barcode";
import type { BarcodeFormat } from "@/lib/types";

const FORMAT_LABELS: Record<BarcodeFormat, string> = {
  qrcode: "QR Code",
  datamatrix: "Data Matrix",
  code128: "Code 128",
  ean13: "EAN-13",
  upca: "UPC-A",
  code39: "Code 39",
};

const HEADER_LABEL =
  "text-[10px] font-semibold uppercase tracking-wider text-text-secondary";

/**
 * What a fence body resolves to. `empty` is a body that is not a usable config:
 * mid-stream it is still arriving, so a skeleton is honest; after the stream
 * ends it is malformed, and saying so beats a skeleton that pulses forever.
 */
type BarcodeView =
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      svg: string;
      label: string;
      text: string;
      caption?: string;
    };

interface BarcodeRendererProps {
  content: string;
  isStreaming?: boolean;
}

/**
 * Renders a ```` ```barcode ```` fence as a scanable symbol.
 *
 * bwip-js is imported here, not in `lib/barcode.ts`, so the config/options
 * logic stays pure and testable and the encoder rides in this component's lazy
 * chunk. `toSVG` throws a string-or-Error on a symbol it cannot encode — a bad
 * EAN-13 check digit, say — which reaches the reader instead of being swallowed.
 */
export function BarcodeRenderer({
  content,
  isStreaming,
}: BarcodeRendererProps) {
  const [isCopied, setIsCopied] = React.useState(false);
  const copyResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const view = React.useMemo<BarcodeView>(() => {
    const config = parseBarcodeConfig(content);
    if (!config) {
      return { status: "empty" };
    }
    try {
      return {
        status: "ready",
        svg: toSVG(buildBarcodeOptions(config)),
        label: FORMAT_LABELS[config.format],
        text: config.text,
        caption: config.caption,
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [content]);

  React.useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  if (view.status === "empty") {
    return isStreaming ? <BarcodeSkeleton /> : <BarcodeError />;
  }

  if (view.status === "error") {
    return <BarcodeError message={view.message} />;
  }

  return (
    <div className="my-6 rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
        <span className={HEADER_LABEL}>{view.label}</span>
        <button
          className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
          onClick={async () => {
            await navigator.clipboard.writeText(view.text);
            setIsCopied(true);
            if (copyResetTimeoutRef.current) {
              clearTimeout(copyResetTimeoutRef.current);
            }
            copyResetTimeoutRef.current = setTimeout(() => {
              setIsCopied(false);
            }, 1500);
          }}
          aria-label={isCopied ? "Copied" : "Copy encoded text"}
        >
          {isCopied ? "Copied" : "Copy"}
        </button>
      </div>

      {/*
        A barcode is a machine-read symbol: an inverted one fails on many
        scanners, so this panel stays white in both themes. Its padding is the
        quiet zone scanners need, in CSS pixels rather than BWIPP's points.
      */}
      <div
        className="flex justify-center p-5"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div
          role="img"
          aria-label={`${view.label} encoding ${view.text}`}
          className="[&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: view.svg }}
        />
      </div>

      {view.caption && (
        <div className="px-4 py-2.5 border-t border-card-border">
          <p className="text-sm text-text-secondary whitespace-pre-wrap wrap-break-words">
            {view.caption}
          </p>
        </div>
      )}
    </div>
  );
}

function BarcodeSkeleton() {
  return (
    <div className="my-6 rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
        <div className="h-3 w-16 rounded bg-muted animate-pulse" />
        <div className="h-3 w-8 rounded bg-muted animate-pulse" />
      </div>
      <div
        className="flex justify-center p-5"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="h-[120px] w-[220px] rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}

function BarcodeError({ message }: { message?: string }) {
  return (
    <div className="my-6 rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
        <span className={HEADER_LABEL}>Barcode</span>
        <span className="pill-red">Error</span>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-[var(--red)]">
          {message ?? "This does not look like a barcode config."}
        </p>
        <p className="text-xs text-text-secondary mt-2">
          Expected JSON with a <code>format</code> and a <code>text</code>.
          Supported formats: {BARCODE_FORMATS.join(", ")}.
        </p>
      </div>
    </div>
  );
}
