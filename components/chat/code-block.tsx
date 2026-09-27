"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { warmDarkTheme, warmLightTheme } from "@/constants/theme";
import { MermaidStreamingSkeleton } from "@/components/chat/mermaid";
import { useTheme } from "next-themes";
import { useCanvasStore } from "@/lib/stores/canvas-store";
import { cn } from "@/lib/utils";
import { useParams } from "next/navigation";

const SyntaxHighlighter = dynamic(
  () => import("react-syntax-highlighter").then((mod) => ({ default: mod.Prism })),
  { ssr: false, loading: () => <div className="animate-pulse rounded-xl bg-card-bg border border-card-border p-6 my-6 h-24" /> },
);

const Mermaid = dynamic(
  () => import("@/components/chat/mermaid").then((mod) => ({ default: mod.Mermaid })),
  { loading: () => <MermaidStreamingSkeleton /> },
);

const ChartRenderer = dynamic(
  () => import("@/components/chat/chart-renderer").then((mod) => ({ default: mod.ChartRenderer })),
  { loading: () => <div className="animate-pulse rounded-xl bg-card-bg border border-card-border p-6 my-6 h-40" /> },
);

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  isStreaming?: boolean;
}

export function CodeBlock({
  className,
  children,
  isStreaming,
  ...props
}: CodeBlockProps) {
  const [isCopied, setIsCopied] = React.useState(false);
  const copyResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { resolvedTheme } = useTheme();
  const isHydrated = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const openCanvas = useCanvasStore((state) => state.openCanvas);
  const params = useParams();
  const codeContent = String(children).replace(/\n$/, "");
  const versionId = React.useMemo(() => {
    let hash = 0;
    for (let i = 0; i < codeContent.length; i++) {
      hash = (hash << 5) - hash + codeContent.charCodeAt(i);
      hash |= 0;
    }
    return `code_${Math.abs(hash).toString(16)}`;
  }, [codeContent]);
  const match = /language-([\w-]+)/.exec(className || "");
  const isInline = !match && !String(children).includes("\n");
  const language = match ? match[1] : "text";
  type RendererProps = Parameters<
    NonNullable<React.ComponentProps<typeof SyntaxHighlighter>["renderer"]>
  >[0];
  type RendererNode = RendererProps["rows"][number];
  type StyleSheet = RendererProps["stylesheet"];
  const renderNode = (
    node: RendererNode,
    index: number,
    depth: number,
    stylesheet: StyleSheet,
    useInlineStyles: boolean,
  ): React.ReactNode => {
    if (node.type === "text") {
      return String(node.value ?? "");
    }

    if (node.tagName) {
      const Tag = node.tagName;
      const { className: rawClassName, ...nodeProps } = (node.properties ||
        {}) as {
        className?: string | string[];
        [key: string]: unknown;
      };
      const classes = Array.isArray(rawClassName)
        ? rawClassName.filter(
            (className): className is string => typeof className === "string",
          )
        : typeof rawClassName === "string"
          ? rawClassName.split(/\s+/).filter(Boolean)
          : [];
      const joinedClassName = classes.join(" ");

      const style =
        useInlineStyles && classes.length > 0
          ? classes.reduce<React.CSSProperties>(
              (acc, cls) => ({ ...acc, ...(stylesheet[cls] || {}) }),
              {},
            )
          : {};

      return (
        <Tag
          key={`node-${depth}-${index}`}
          className={joinedClassName || undefined}
          style={Object.keys(style).length > 0 ? style : undefined}
          {...nodeProps}
        >
          {node.children?.map((child, i) =>
            renderNode(child, i, depth + 1, stylesheet, useInlineStyles),
          )}
        </Tag>
      );
    }

    return null;
  };

  React.useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  if (isInline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  if (language === "mermaid") {
    if (isStreaming) {
      return <MermaidStreamingSkeleton />;
    }
    return <Mermaid chart={String(children).replace(/\n$/, "")} />;
  }

  if (language === "chart") {
    return <ChartRenderer content={String(children).replace(/\n$/, "")} />;
  }

  if (language === "react-canvas" || language === "canvas") {
    return (
      <div className="my-4 pl-3 pr-2.5 py-2.5 rounded-[20px] border border-card-border bg-card-bg shadow-sm flex flex-row items-center justify-between gap-3 transition-colors hover:border-tertiary/20">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-text-secondary shrink-0 relative overflow-hidden border border-primary/10">
            {isStreaming && (
              <div className="absolute inset-0 bg-primary/20 animate-pulse" />
            )}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className={cn(
                "w-4 h-4 text-primary",
                isStreaming && "animate-pulse",
              )}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="m10 10-2 2 2 2" />
              <path d="m14 14 2-2-2-2" />
            </svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-semibold text-foreground truncate leading-tight">
              {isStreaming
                ? "Generating React Component..."
                : "React Component"}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {isStreaming && (
                <span className="flex h-1.5 w-1.5 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                </span>
              )}
              <span className="text-[12px] text-text-secondary truncate leading-tight">
                {isStreaming
                  ? "Wait for generation to complete"
                  : "Click to preview in Canvas"}
              </span>
            </div>
          </div>
        </div>
        <Button
          onClick={() => {
            if (!isStreaming) {
              const currentThreadId = params?.id as string | undefined;
              openCanvas(
                { id: versionId, code: codeContent, language },
                currentThreadId,
              );
            }
          }}
          disabled={isStreaming}
          size="sm"
          className={cn(
            "h-8 text-[13px] font-medium rounded-full px-5 shrink-0 transition-all ml-2",
            isStreaming
              ? "bg-active-bg text-text-secondary cursor-not-allowed border-none"
              : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-none border border-transparent",
          )}
        >
          {isStreaming ? "Generating..." : "Open"}
        </Button>
      </div>
    );
  }

  const isLight = isHydrated && resolvedTheme === "light";
  const theme = isLight ? warmLightTheme : warmDarkTheme;

  return (
    <div className="group/code my-6 rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
          {match ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
              {language}
            </span>
          ) : (
            <span />
          )}
          <button
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
            onClick={async () => {
              await navigator.clipboard.writeText(
                String(children).replace(/\n$/, ""),
              );
              setIsCopied(true);
              if (copyResetTimeoutRef.current) {
                clearTimeout(copyResetTimeoutRef.current);
              }
              copyResetTimeoutRef.current = setTimeout(() => {
                setIsCopied(false);
              }, 1500);
            }}
            aria-label={isCopied ? "Copied" : "Copy code"}
          >
            {isCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <SyntaxHighlighter
          style={theme}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "0.875rem",
            backgroundColor: "var(--surface-muted)",
            border: "none",
            padding: "0.5rem 1.25rem 1.25rem",
          }}
          renderer={({ rows, stylesheet, useInlineStyles }) => {
            return rows.map((row, i: number) =>
              renderNode(row, i, 0, stylesheet, useInlineStyles),
            );
          }}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
