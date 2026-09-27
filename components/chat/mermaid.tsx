"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import mermaid from "mermaid";
import {
  Copy,
  AlertTriangle,
  FileCode2,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Zoom Preview Modal
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

interface ZoomPreviewProps {
  svg: string;
  onClose: () => void;
}

function ZoomPreview({ svg, onClose }: ZoomPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
  const handleZoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => {
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      return Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM);
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    setIsDraggingState(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    setIsDraggingState(false);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-") handleZoomOut();
      if (e.key === "0") handleReset();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/90 border-b border-zinc-700/50">
        <span className="text-xs text-zinc-400 font-medium">
          Mermaid Diagram Preview
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Zoom out (−)"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-zinc-300 font-mono w-12 text-center tabular-nums">
            {zoomPercent}%
          </span>
          <button
            onClick={handleZoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Zoom in (+)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-1" />
          <button
            onClick={handleReset}
            className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-700/60 transition-colors"
            title="Reset (0)"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-1" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-300 hover:bg-red-500/80 hover:text-white transition-colors"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Zoomable canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="h-full w-full flex items-center justify-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDraggingState
              ? "none"
              : "transform 0.15s ease-out",
          }}
        >
          <div
            className="bg-white rounded-lg p-6 shadow-2xl"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>

      {/* Hints */}
      <div className="flex items-center justify-center gap-4 px-4 py-1.5 bg-zinc-900/90 border-t border-zinc-700/50">
        <span className="text-[10px] text-zinc-500">
          Scroll to zoom · Drag to pan · +/− keys · 0 to reset · Esc to close
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sanitization utilities
// ---------------------------------------------------------------------------

/** Characters that force a label to be double-quoted in Mermaid syntax. */
const SPECIAL_CHARS_RE = /[()<>&;:#!/?@'"\\|{}]/;

/**
 * Strip HTML tags from a string, replacing `<br>` / `<br/>` with a space and
 * removing remaining tags (e.g. `<i>`, `</b>`).
 */
function stripHtmlTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, "");
}

/**
 * If the label isn't already double-quoted and contains special characters,
 * wrap it in double-quotes (escaping inner double-quotes).
 */
function quoteIfNeeded(label: string): string {
  const trimmed = label.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  if (!SPECIAL_CHARS_RE.test(trimmed)) return trimmed;
  const escaped = trimmed.replace(/"/g, "#quot;");
  return `"${escaped}"`;
}

/**
 * Primary sanitization pass — handles most AI-generated issues:
 *  1. Strips HTML tags from inside node labels.
 *  2. Auto-quotes labels containing dangerous characters.
 *  3. Sanitises edge labels inside pipes (|...|).
 *  4. Removes zero-width / invisible unicode characters.
 */
function sanitizeMermaidChart(chart: string): string {
  let result = chart;

  // 1. Remove zero-width / invisible unicode
  result = result.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

  // 2. Process each line individually for label sanitization
  result = result
    .split("\n")
    .map((line) => {
      // Skip directive / config lines
      if (
        /^\s*%%/.test(line) ||
        /^\s*classDef\b/.test(line) ||
        /^\s*style\b/.test(line) ||
        /^\s*click\b/.test(line)
      ) {
        return line;
      }

      // --- Node labels in [] (square brackets) ---
      // Matches  ID[label]  but not already-quoted  ID["label"]
      line = line.replace(
        /(\b[\w.-]+)\[([^\]"]+)\]/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}[${quoteIfNeeded(cleaned)}]`;
        },
      );

      // --- Node labels in {} (rhombus / decision diamonds) ---
      line = line.replace(
        /(\b[\w.-]+)\{([^}"]+)\}/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}{${quoteIfNeeded(cleaned)}}`;
        },
      );

      // --- Node labels in (()) (circles / double-circles) ---
      line = line.replace(
        /(\b[\w.-]+)\(\(([^)"]+)\)\)/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}((${quoteIfNeeded(cleaned)}))`;
        },
      );

      // --- Node labels in () (stadium shapes) ---
      line = line.replace(
        /(\b[\w.-]+)\(([^)"(]+)\)/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}(${quoteIfNeeded(cleaned)})`;
        },
      );

      // --- Node labels in ([]) (cylindrical) ---
      line = line.replace(
        /(\b[\w.-]+)\(\[([^\]"]+)\]\)/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}([${quoteIfNeeded(cleaned)}])`;
        },
      );

      // --- Node labels in [[]] (subroutine) ---
      line = line.replace(
        /(\b[\w.-]+)\[\[([^\]"]+)\]\]/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}[[${quoteIfNeeded(cleaned)}]]`;
        },
      );

      // --- Node labels in >] (asymmetric / flag shapes) ---
      line = line.replace(
        /(\b[\w.-]+)>([^\]"]+)\]/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}>${quoteIfNeeded(cleaned)}]`;
        },
      );

      // --- Node labels in {{}} (hexagon) ---
      line = line.replace(
        /(\b[\w.-]+)\{\{([^}"]+)\}\}/g,
        (_match, nodeId: string, label: string) => {
          const cleaned = stripHtmlTags(label);
          return `${nodeId}{{${quoteIfNeeded(cleaned)}}}`;
        },
      );

      // --- Edge labels in pipes  -->|label|  ---
      line = line.replace(/\|([^"|]+)\|/g, (_match, label: string) => {
        const cleaned = stripHtmlTags(label);
        return `|${quoteIfNeeded(cleaned)}|`;
      });

      return line;
    })
    .join("\n");

  return result;
}

/**
 * Aggressive simplification — used as a second attempt when the first
 * sanitization pass still fails. This strips everything non-essential to
 * maximise the chance of a successful parse.
 */
function aggressiveSimplify(chart: string): string {
  return chart
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // Remove style, classDef, click, linkStyle lines
      if (/^\s*(classDef|style|click|linkStyle)\b/.test(trimmed)) return false;
      return true;
    })
    .map((line) => {
      // Replace any remaining shape syntax with simple [] if still failing
      // Strip HTML-like content aggressively
      let cleaned = line.replace(/<[^>]+>/g, " ");
      // Collapse whitespace
      cleaned = cleaned.replace(/\s{2,}/g, " ");
      return cleaned;
    })
    .join("\n");
}

function sanitizeRenderedSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?\/?>/gi, "")
    .replace(/\son[a-zA-Z]+\s*=\s*"[^"]*"/g, "")
    .replace(/\son[a-zA-Z]+\s*=\s*'[^']*'/g, "")
    .replace(/\son[a-zA-Z]+\s*=\s*[^\s>]+/g, "")
    .replace(/\shref\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, "")
    .replace(/\sxlink:href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, "");
}

// ---------------------------------------------------------------------------
// Skeleton SVG shared by streaming + loading states
// ---------------------------------------------------------------------------

function DiagramSkeleton({ label }: { label: string }) {
  return (
    <div className="flex justify-center my-6">
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 p-8 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <svg
          viewBox="0 0 400 220"
          className="w-full h-auto opacity-60"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="mermaid-shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.06">
                <animate attributeName="offset" values="-1;2" dur="1.8s" repeatCount="indefinite" />
              </stop>
              <stop offset="50%" stopColor="currentColor" stopOpacity="0.15">
                <animate attributeName="offset" values="-0.5;2.5" dur="1.8s" repeatCount="indefinite" />
              </stop>
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.06">
                <animate attributeName="offset" values="0;3" dur="1.8s" repeatCount="indefinite" />
              </stop>
            </linearGradient>
          </defs>

          {/* Top node */}
          <rect x="140" y="10" width="120" height="36" rx="6" fill="url(#mermaid-shimmer)" stroke="currentColor" strokeOpacity="0.12" />
          <rect x="160" y="22" width="80" height="10" rx="3" fill="currentColor" opacity="0.08" />

          {/* Connector line down */}
          <line x1="200" y1="46" x2="200" y2="70" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>

          {/* Middle node (diamond) */}
          <polygon points="200,70 250,95 200,120 150,95" fill="url(#mermaid-shimmer)" stroke="currentColor" strokeOpacity="0.12" />
          <rect x="175" y="88" width="50" height="10" rx="3" fill="currentColor" opacity="0.08" />

          {/* Left branch */}
          <line x1="150" y1="95" x2="80" y2="95" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <line x1="80" y1="95" x2="80" y2="140" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <rect x="30" y="140" width="100" height="36" rx="6" fill="url(#mermaid-shimmer)" stroke="currentColor" strokeOpacity="0.12" />
          <rect x="45" y="152" width="70" height="10" rx="3" fill="currentColor" opacity="0.08" />

          {/* Right branch */}
          <line x1="250" y1="95" x2="320" y2="95" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <line x1="320" y1="95" x2="320" y2="140" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <rect x="270" y="140" width="100" height="36" rx="6" fill="url(#mermaid-shimmer)" stroke="currentColor" strokeOpacity="0.12" />
          <rect x="285" y="152" width="70" height="10" rx="3" fill="currentColor" opacity="0.08" />

          {/* Bottom merge lines */}
          <line x1="80" y1="176" x2="80" y2="195" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <line x1="320" y1="176" x2="320" y2="195" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <line x1="80" y1="195" x2="320" y2="195" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="7;0" dur="0.8s" repeatCount="indefinite" />
          </line>
        </svg>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-3 animate-pulse">
          {label}
        </p>
      </div>
    </div>
  );
}

export function MermaidStreamingSkeleton() {
  return <DiagramSkeleton label="Generating diagram…" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let mermaidInitialized = false;
function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    suppressErrorRendering: true,
  });
  mermaidInitialized = true;
}

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const [svg, setSvg] = useState<string>("");
  const [renderState, setRenderState] = useState<
    "loading" | "success" | "fallback"
  >("loading");
  const [showPreview, setShowPreview] = useState(false);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(chart);
  }, [chart]);

  useEffect(() => {
    let cancelled = false;

    const renderChart = async () => {
      setRenderState("loading");
      setSvg("");

      ensureMermaidInit();

      // --- Attempt 1: sanitized chart ---
      try {
        const sanitized = sanitizeMermaidChart(chart);
        const id1 = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
        const result = await mermaid.render(id1, sanitized);
        if (!cancelled) {
          setSvg(sanitizeRenderedSvg(result.svg));
          setRenderState("success");
        }
        return;
      } catch {
        // Attempt 1 failed, continue to attempt 2
      }

      // --- Attempt 2: aggressive simplification ---
      try {
        const simplified = aggressiveSimplify(sanitizeMermaidChart(chart));
        const id2 = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
        const result = await mermaid.render(id2, simplified);
        if (!cancelled) {
          setSvg(sanitizeRenderedSvg(result.svg));
          setRenderState("success");
        }
        return;
      } catch {
        // Attempt 2 failed, continue to attempt 3
      }

      // --- Attempt 3: minimal structural render ---
      // Try to extract just the graph direction + node connections without labels
      try {
        const lines = chart.split("\n");
        const header = lines[0]; // e.g. "graph TD" or "sequenceDiagram"
        const connections = lines
          .slice(1)
          .map((l) => {
            // Keep only arrows and node IDs, strip labels
            const arrowMatch = l.match(
              /^\s*([\w.-]+)\s*(-->|---|-\.-|==>|-.->|-->\|[^|]*\||--\s|~~>|<-->)\s*([\w.-]+)/,
            );
            if (arrowMatch) {
              return `  ${arrowMatch[1]} ${arrowMatch[2].replace(/\|[^|]*\|/, "-->")} ${arrowMatch[3]}`;
            }
            // Keep subgraph open/close
            if (/^\s*(subgraph|end)\b/i.test(l.trim())) return l;
            return null;
          })
          .filter(Boolean);

        if (connections.length > 0) {
          const minimal = [header, ...connections].join("\n");
          const id3 = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
          const result = await mermaid.render(id3, minimal);
          if (!cancelled) {
            setSvg(sanitizeRenderedSvg(result.svg));
            setRenderState("success");
          }
          return;
        }
      } catch {
        // All attempts failed
      }

      // --- Fallback: show raw source ---
      if (!cancelled) {
        setRenderState("fallback");
      }
    };

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  // Fallback UI — styled raw code display
  if (renderState === "fallback") {
    return (
      <div className="my-6 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-amber-100/60 dark:bg-amber-900/30 border-b border-amber-500/20">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Diagram could not be rendered — showing source
          </div>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors px-2 py-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/40"
            title="Copy diagram source"
          >
            <Copy className="h-3 w-3" />
            Copy
          </button>
        </div>
        <div className="relative">
          <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-amber-500/60 dark:text-amber-400/40 font-mono">
            <FileCode2 className="h-3 w-3" />
            mermaid
          </div>
          <pre className="p-4 text-xs font-mono text-amber-900 dark:text-amber-200/80 overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {chart}
          </pre>
        </div>
      </div>
    );
  }

  // Loading state — diagram-like skeleton
  if (renderState === "loading") {
    return <DiagramSkeleton label="Rendering diagram…" />;
  }

  // Success — render SVG with fade-in
  // SVG content is sanitized via sanitizeRenderedSvg() which strips scripts and event handlers
  return (
    <>
      <div
        className="group relative my-6 overflow-x-auto bg-white p-4 rounded-lg animate-[mermaid-fade-in_0.4s_ease-out]"
        style={{ animation: "mermaid-fade-in 0.4s ease-out" }}
      >
        <style>{`@keyframes mermaid-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        <div
          className="flex justify-center"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <button
          onClick={() => setShowPreview(true)}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-zinc-800/70 text-white opacity-0 group-hover:opacity-100 hover:bg-zinc-700 transition-all shadow-lg"
          title="Full preview"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {showPreview && (
        <ZoomPreview svg={svg} onClose={() => setShowPreview(false)} />
      )}
    </>
  );
}
