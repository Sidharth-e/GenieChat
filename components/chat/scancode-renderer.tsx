"use client";

import * as React from "react";
import { toSVG } from "bwip-js/browser";

import {
  SCANCODE_FORMATS,
  SCANCODE_FORMAT_LABELS,
  buildScancodeOptions,
  parseScancodeConfig,
  scancodeFileName,
  withIntrinsicSize,
} from "@/lib/scancode";

const HEADER_LABEL =
  "text-[10px] font-semibold uppercase tracking-wider text-text-secondary";

const HEADER_ACTION =
  "text-[11px] font-medium text-primary hover:text-primary/80 transition-colors";

/**
 * What a fence body resolves to. `empty` is a body that is not a usable config:
 * mid-stream it is still arriving, so a skeleton is honest; after the stream
 * ends it is malformed, and saying so beats a skeleton that pulses forever.
 */
type ScancodeView =
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      svg: string;
      label: string;
      text: string;
      fileName: string;
      caption?: string;
    };

interface ScancodeRendererProps {
  content: string;
  isStreaming?: boolean;
}

/**
 * Renders a ```` ```scancode ```` fence as a scanable symbol — a QR, a Data
 * Matrix, or a linear barcode, depending on the fence's `format`.
 *
 * bwip-js is imported here, not in `lib/scancode.ts`, so the config/options
 * logic stays pure and testable and the encoder rides in this component's lazy
 * chunk. `toSVG` throws a string-or-Error on a symbol it cannot encode — a bad
 * EAN-13 check digit, say — which reaches the reader instead of being swallowed.
 */
export function ScancodeRenderer({
  content,
  isStreaming,
}: ScancodeRendererProps) {
  const [isCopied, setIsCopied] = React.useState(false);
  const copyResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const revokeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const view = React.useMemo<ScancodeView>(() => {
    const config = parseScancodeConfig(content);
    if (!config) {
      return { status: "empty" };
    }
    try {
      return {
        status: "ready",
        svg: withIntrinsicSize(toSVG(buildScancodeOptions(config))),
        label: SCANCODE_FORMAT_LABELS[config.format],
        text: config.text,
        fileName: scancodeFileName(config),
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
      if (revokeTimeoutRef.current) {
        clearTimeout(revokeTimeoutRef.current);
      }
    };
  }, []);

  if (view.status === "empty") {
    return isStreaming ? <ScancodeSkeleton /> : <ScancodeError />;
  }

  if (view.status === "error") {
    return <ScancodeError message={view.message} />;
  }

  const handleDownload = () => {
    const blob = new Blob([view.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = view.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick rather than straight away: the download reads
    // the blob after `click()` returns, and a synchronous revoke can cancel it.
    if (revokeTimeoutRef.current) {
      clearTimeout(revokeTimeoutRef.current);
    }
    revokeTimeoutRef.current = setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(view.text);
    setIsCopied(true);
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = setTimeout(() => {
      setIsCopied(false);
    }, 1500);
  };

  return (
    <div className="my-6 rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
        <span className={HEADER_LABEL}>{view.label}</span>
        <div className="flex items-center gap-3">
          <button
            className={HEADER_ACTION}
            onClick={handleDownload}
            aria-label={`Download ${view.label} as SVG`}
          >
            Download
          </button>
          <button
            className={HEADER_ACTION}
            onClick={handleCopy}
            aria-label={isCopied ? "Copied" : "Copy encoded text"}
          >
            {isCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/*
        A scan code is a machine-read symbol: an inverted one fails on many
        scanners, so this panel stays white in both themes. Its padding is the
        quiet zone scanners need, in CSS pixels rather than BWIPP's points.

        The symbol is sized by `withIntrinsicSize`, not by CSS on this subtree:
        a `[&>svg]:` variant here compiles to nothing when Tailwind does not
        emit it, which is exactly how an unsized SVG ends up filling the card.
      */}
      <div
        className="flex justify-center p-5"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div
          role="img"
          aria-label={`${view.label} encoding ${view.text}`}
          dangerouslySetInnerHTML={{ __html: view.svg }}
        />
      </div>

      {view.caption && (
        <div className="px-4 py-2.5 border-t border-card-border">
          <p className="text-sm text-text-secondary whitespace-pre-wrap wrap-break-word">
            {view.caption}
          </p>
        </div>
      )}
    </div>
  );
}

function ScancodeSkeleton() {
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

function ScancodeError({ message }: { message?: string }) {
  return (
    <div className="my-6 rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
        <span className={HEADER_LABEL}>Scan code</span>
        <span className="pill-red">Error</span>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-[var(--red)]">
          {message ?? "This does not look like a scan code config."}
        </p>
        <p className="text-xs text-text-secondary mt-2">
          Expected JSON with a <code>format</code> and a <code>text</code>.
          Supported formats: {SCANCODE_FORMATS.join(", ")}.
        </p>
      </div>
    </div>
  );
}
