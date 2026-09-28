"use client";

import { useState, useMemo } from "react";
import { ToolCall } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Sparkles,
  Wand2,
  GitBranch,
  BarChart2,
  Layers,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  BookmarkX,
  Terminal,
  Zap,
  Calendar,
  Mail,
  CheckSquare,
  Users,
  FolderSearch,
  ArrowRightLeft,
  Bot,
  Wrench,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MessageContent } from "@/components/common/message-content";
import { useCanvasStore } from "@/lib/stores/canvas-store";
import { useParams } from "next/navigation";
import { formatModelName } from "@/lib/langchain/model-config";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCallBlockProps {
  toolCall: ToolCall;
  isStreaming?: boolean;
}

interface ToolCallGroupProps {
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  routedModel?: string;
  isAutoRouter?: boolean;
}

interface ParsedImageResult {
  success?: boolean;
  image_url?: string;
  image_base64?: string;
  format?: string;
  revised_prompt?: string;
  size?: string;
}

interface ArtifactPreviewInfo {
  id: string;
  type: "canvas" | "mermaid" | "chart";
  title: string;
  code: string;
  downloadUrl?: string;
}

const ARTIFACT_TOOL_NAMES = new Set(["generate_canvas", "generate_mermaid", "generate_chart"]);

function parseArtifactFromResult(
  toolId: string,
  toolName: string,
  result: string,
): ArtifactPreviewInfo | null {
  if (!ARTIFACT_TOOL_NAMES.has(toolName)) return null;
  try {
    const parsed = JSON.parse(result);
    if (toolName === "generate_canvas" && parsed.react_canvas_code) {
      return {
        id: toolId,
        type: "canvas",
        title: "React Component",
        code: parsed.react_canvas_code,
        downloadUrl: parsed.artifact_download_url ?? undefined,
      };
    }
    if (toolName === "generate_mermaid" && parsed.mermaid_code) {
      return {
        id: toolId,
        type: "mermaid",
        title: "Mermaid Diagram",
        code: parsed.mermaid_code,
        downloadUrl: parsed.artifact_download_url ?? undefined,
      };
    }
    if (toolName === "generate_chart" && parsed.chart_config) {
      return {
        id: toolId,
        type: "chart",
        title: parsed.chart_config.title || "Chart",
        code: JSON.stringify(parsed.chart_config),
        downloadUrl: parsed.artifact_download_url ?? undefined,
      };
    }
  } catch {}
  return null;
}

// ── Tool configuration ────────────────────────────────────────────────────────

type ToolAccent =
  | "amber"
  | "violet"
  | "teal"
  | "sky"
  | "fuchsia"
  | "emerald"
  | "rose"
  | "zinc"
  | "yellow"
  | "blue"
  | "indigo"
  | "gray";

interface ToolConfig {
  icon: LucideIcon;
  accent: ToolAccent;
  /** Past tense — shown after the tool has a result */
  label: (args: Record<string, unknown>) => string;
  /** Present continuous — shown while the tool is running */
  activeLabel: (args: Record<string, unknown>) => string;
  /** Past tense short form for the collapsed header */
  summaryLabel: string;
  /** Present tense short form for the collapsed header while streaming */
  activeSummaryLabel: string;
}

const ACCENT_CLASSES: Record<ToolAccent, { bg: string; text: string }> = {
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-400" },
  violet:  { bg: "bg-violet-500/10",  text: "text-violet-400" },
  teal:    { bg: "bg-teal-500/10",    text: "text-teal-400" },
  sky:     { bg: "bg-sky-500/10",     text: "text-sky-400" },
  fuchsia: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-400" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  rose:    { bg: "bg-rose-500/10",    text: "text-rose-400" },
  zinc:    { bg: "bg-zinc-500/10",    text: "text-zinc-400" },
  yellow:  { bg: "bg-yellow-500/10",  text: "text-yellow-400" },
  blue:    { bg: "bg-blue-500/10",    text: "text-blue-400" },
  indigo:  { bg: "bg-indigo-500/10",  text: "text-indigo-400" },
  gray:    { bg: "bg-gray-500/10",    text: "text-gray-400" },
};

const TOOL_CONFIGS: Partial<Record<string, ToolConfig>> = {
  web_search: {
    icon: Globe,
    accent: "amber",
    activeLabel: (a) => `Searching for "${String(a.query ?? "").slice(0, 60)}"…`,
    label: (a) => `Searched for "${String(a.query ?? "").slice(0, 60)}"`,
    activeSummaryLabel: "searching the web",
    summaryLabel: "searched the web",
  },
  generate_image: {
    icon: Sparkles,
    accent: "violet",
    activeLabel: () => "Generating image…",
    label: () => "Generated an image",
    activeSummaryLabel: "generating an image",
    summaryLabel: "generated an image",
  },
  edit_image: {
    icon: Wand2,
    accent: "violet",
    activeLabel: () => "Editing image…",
    label: () => "Edited an image",
    activeSummaryLabel: "editing an image",
    summaryLabel: "edited an image",
  },
  generate_mermaid: {
    icon: GitBranch,
    accent: "teal",
    activeLabel: () => "Creating diagram…",
    label: () => "Created a diagram",
    activeSummaryLabel: "creating a diagram",
    summaryLabel: "created a diagram",
  },
  generate_chart: {
    icon: BarChart2,
    accent: "sky",
    activeLabel: () => "Generating chart…",
    label: () => "Generated a chart",
    activeSummaryLabel: "generating a chart",
    summaryLabel: "generated a chart",
  },
  generate_canvas: {
    icon: Layers,
    accent: "fuchsia",
    activeLabel: () => "Building UI component…",
    label: () => "Built a UI component",
    activeSummaryLabel: "building a component",
    summaryLabel: "built a component",
  },
  knowledge_base_search: {
    icon: BookOpen,
    accent: "emerald",
    activeLabel: (a) => `Searching documents for "${String(a.query ?? "").slice(0, 50)}"…`,
    label: (a) => `Searched documents for "${String(a.query ?? "").slice(0, 50)}"`,
    activeSummaryLabel: "searching documents",
    summaryLabel: "searched documents",
  },
  save_memory: {
    icon: Bookmark,
    accent: "rose",
    activeLabel: (a) => `Saving to memory: "${String(a.content ?? "").slice(0, 50)}"…`,
    label: (a) => `Saved to memory: "${String(a.content ?? "").slice(0, 50)}"`,
    activeSummaryLabel: "saving a memory",
    summaryLabel: "saved a memory",
  },
  edit_memory: {
    icon: BookmarkCheck,
    accent: "rose",
    activeLabel: () => "Updating memory…",
    label: () => "Updated a memory",
    activeSummaryLabel: "updating a memory",
    summaryLabel: "updated a memory",
  },
  delete_memory: {
    icon: BookmarkX,
    accent: "rose",
    activeLabel: () => "Deleting memory…",
    label: () => "Deleted a memory",
    activeSummaryLabel: "deleting a memory",
    summaryLabel: "deleted a memory",
  },
  code_interpreter: {
    icon: Terminal,
    accent: "zinc",
    activeLabel: (a) => a.language ? `Running ${String(a.language)} code…` : "Running code…",
    label: (a) => a.language ? `Ran ${String(a.language)} code` : "Ran code",
    activeSummaryLabel: "running code",
    summaryLabel: "ran code",
  },
  use_skill: {
    icon: Zap,
    accent: "yellow",
    activeLabel: (a) => `Loading skill: ${String(a.skill_name ?? "")}…`,
    label: (a) => `Used skill: ${String(a.skill_name ?? "")}`,
    activeSummaryLabel: "loading a skill",
    summaryLabel: "used a skill",
  },
  // The Graph tools below no longer exist, but tool calls made by them are
  // still persisted in older threads. These entries are what label those
  // historical messages; do not remove them as dead code.
  list_calendar_events: {
    icon: Calendar,
    accent: "blue",
    activeLabel: () => "Checking calendar…",
    label: () => "Checked calendar",
    activeSummaryLabel: "checking calendar",
    summaryLabel: "checked calendar",
  },
  list_emails: {
    icon: Mail,
    accent: "blue",
    activeLabel: () => "Reading emails…",
    label: () => "Read emails",
    activeSummaryLabel: "reading emails",
    summaryLabel: "read emails",
  },
  read_email_by_subject: {
    icon: Mail,
    accent: "blue",
    activeLabel: (a) => `Reading email "${String(a.subject ?? "").slice(0, 50)}"…`,
    label: (a) => `Read email "${String(a.subject ?? "").slice(0, 50)}"`,
    activeSummaryLabel: "reading an email",
    summaryLabel: "read an email",
  },
  create_reminder: {
    icon: CheckSquare,
    accent: "blue",
    activeLabel: (a) => `Creating reminder: "${String(a.title ?? "").slice(0, 50)}"…`,
    label: (a) => `Created reminder: "${String(a.title ?? "").slice(0, 50)}"`,
    activeSummaryLabel: "creating a reminder",
    summaryLabel: "created a reminder",
  },
  list_reminders: {
    icon: CheckSquare,
    accent: "blue",
    activeLabel: () => "Listing reminders…",
    label: () => "Listed reminders",
    activeSummaryLabel: "listing reminders",
    summaryLabel: "listed reminders",
  },
  search_users: {
    icon: Users,
    accent: "blue",
    activeLabel: (a) => `Searching for user "${String(a.query ?? "").slice(0, 40)}"…`,
    label: (a) => `Found user "${String(a.query ?? "").slice(0, 40)}"`,
    activeSummaryLabel: "searching users",
    summaryLabel: "searched users",
  },
  search_files: {
    icon: FolderSearch,
    accent: "blue",
    activeLabel: (a) => `Searching files for "${String(a.query ?? "").slice(0, 40)}"…`,
    label: (a) => `Searched files for "${String(a.query ?? "").slice(0, 40)}"`,
    activeSummaryLabel: "searching files",
    summaryLabel: "searched files",
  },
};

function getToolConfig(name: string): ToolConfig {
  if (TOOL_CONFIGS[name]) return TOOL_CONFIGS[name]!;
  if (name.startsWith("transfer_to_") || name.startsWith("ask_")) {
    const agentName = name
      .replace(/^(transfer_to_|ask_)/, "")
      .replace(/_/g, " ");
    return {
      icon: ArrowRightLeft,
      accent: "indigo",
      activeLabel: () => `Handing off to ${agentName}…`,
      label: () => `Handed off to ${agentName}`,
      activeSummaryLabel: "delegating to agent",
      summaryLabel: "delegated to agent",
    };
  }
  const readable = name.replace(/_/g, " ");
  return {
    icon: Wrench,
    accent: "gray",
    activeLabel: () => `Running ${readable}…`,
    label: () => `Used ${readable}`,
    activeSummaryLabel: `running ${readable}`,
    summaryLabel: readable,
  };
}

// ── Summary header text ───────────────────────────────────────────────────────

function buildSummaryText(toolCalls: ToolCall[], anyStreaming: boolean): string {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const tc of toolCalls) {
    const cfg = getToolConfig(tc.name);
    // A tool is "active" if it has no result yet
    const isActive = !tc.result;
    const label = isActive && anyStreaming
      ? cfg.activeSummaryLabel
      : cfg.summaryLabel;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  if (!labels.length) return "Using tools";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (labels.length === 1) return cap(labels[0]);
  const last = labels.pop()!;
  return cap(labels.join(", ") + " and " + last);
}

function getDelegatedAgentName(toolName: string): string {
  return toolName
    .replace(/^(ask_|transfer_to_)/, "")
    .split("_")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// ── Inline result parsers ─────────────────────────────────────────────────────

function parseWebSearchResult(result: string) {
  try {
    const p = JSON.parse(result);
    if (p.answer || p.citations)
      return p as { answer?: string; citations?: string[]; query?: string };
  } catch {}
  return null;
}

function parseKBResult(result: string) {
  try {
    const p = JSON.parse(result);
    if (Array.isArray(p.results))
      return p.results as { title: string; score: number }[];
  } catch {}
  return null;
}

function parseImageResult(result: string): ParsedImageResult | null {
  try {
    const p = JSON.parse(result);
    if (p.success && (p.image_url || p.image_base64)) return p;
  } catch {}
  return null;
}

// ── Artifact Preview Card ────────────────────────────────────────────────────

function ArtifactPreviewCard({ artifact }: { artifact: ArtifactPreviewInfo }) {
  const openCanvas = useCanvasStore((state) => state.openCanvas);
  const params = useParams();
  const threadId = params?.id as string | undefined;

  const versionId = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < artifact.code.length; i++) {
      hash = (hash << 5) - hash + artifact.code.charCodeAt(i);
      hash |= 0;
    }
    return `code_${Math.abs(hash).toString(16)}`;
  }, [artifact.code]);

  const iconMap: Record<ArtifactPreviewInfo["type"], LucideIcon> = {
    canvas: Layers,
    mermaid: GitBranch,
    chart: BarChart2,
  };
  const Icon = iconMap[artifact.type];

  return (
    <div className="mt-2 pl-3 pr-2.5 py-2.5 rounded-[20px] border border-card-border bg-card-bg shadow-sm flex items-center justify-between gap-3 transition-colors hover:border-tertiary/20">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0 border border-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[14px] font-semibold text-foreground truncate leading-tight">
            {artifact.title}
          </span>
          <span className="text-[12px] text-text-secondary truncate leading-tight">
            {artifact.type === "canvas"
              ? "Click to preview in Canvas"
              : "Saved as artifact"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {artifact.downloadUrl && (
          <a
            href={artifact.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-8 w-8 flex items-center justify-center rounded-full text-text-secondary/50 hover:text-primary hover:bg-hover-bg transition-colors"
            title="Download"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {artifact.type === "canvas" && (
          <button
            onClick={() =>
              openCanvas(
                { id: versionId, code: artifact.code, language: "react-canvas" },
                threadId,
              )
            }
            className="h-8 px-5 text-[13px] font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Open
          </button>
        )}
      </div>
    </div>
  );
}

function RoutingRow({
  routedModel,
  isStreaming,
  showBottomLine,
}: {
  routedModel?: string;
  isStreaming?: boolean;
  showBottomLine: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const targetName = routedModel ? formatModelName(routedModel) : undefined;

  return (
    <div className="flex">
      <div className="flex flex-col items-center w-7 shrink-0">
        <div className="w-0.5 h-[10px] rounded-full bg-white/10" />
        <div className="h-5 w-5 rounded-md flex items-center justify-center shrink-0 z-10 bg-primary/10 border border-primary/20">
          <ArrowRightLeft
            className={cn(
              "h-3 w-3 text-primary",
              isStreaming && "animate-pulse",
            )}
          />
        </div>
        {showBottomLine ? (
          <div className="w-0.5 flex-1 rounded-full bg-white/10 min-h-[12px]" />
        ) : (
          <div className="h-2" />
        )}
      </div>

      <div className="flex-1 pb-2.5 pl-2.5 min-w-0">
        <button
          className="w-full text-left"
          onClick={() => setDetailOpen((o) => !o)}
        >
          <div className="flex items-center gap-1.5 py-0.5 min-h-[28px]">
            <span
              className={cn(
                "text-sm leading-snug",
                isStreaming ? "text-text-secondary" : "text-foreground/80",
              )}
            >
              {isStreaming && !targetName
                ? "Routing request via Jev Router…"
                : targetName
                  ? `Routed via Jev Router → Handed off to ${targetName}`
                  : "Routed via Jev Router"}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-text-secondary/50 shrink-0 transition-transform duration-150",
                detailOpen && "rotate-180",
              )}
            />
          </div>
        </button>

        {detailOpen && (
          <div className="mb-2 space-y-1.5">
            <div className="rounded-md border border-border/20 bg-secondary/10 p-2 overflow-x-auto">
              <div className="text-[10px] font-medium text-text-secondary/50 uppercase tracking-wider mb-1">
                Router
              </div>
              <p className="text-xs text-foreground/70 font-mono">
                typesafe/jev-router
              </p>
            </div>
            {routedModel ? (
              <div className="rounded-md border border-border/20 bg-secondary/10 p-2 overflow-x-auto">
                <div className="text-[10px] font-medium text-text-secondary/50 uppercase tracking-wider mb-1">
                  Target Model
                </div>
                <p className="text-xs text-primary font-mono font-medium">
                  {routedModel}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ToolCallGroup ─────────────────────────────────────────────────────────────

export function ToolCallGroup({
  toolCalls = [],
  isStreaming,
  routedModel,
  isAutoRouter,
}: ToolCallGroupProps) {
  const [isOpen, setIsOpen] = useState(false);

  const anyStreaming = !!isStreaming && toolCalls.some((tc) => !tc.result);
  const allDone =
    !anyStreaming &&
    (toolCalls.length === 0 || toolCalls.every((tc) => !!tc.result));

  const summaryText = useMemo(() => {
    if (isAutoRouter) {
      const targetName = routedModel
        ? formatModelName(routedModel)
        : isStreaming
          ? "Routing…"
          : "Auto Mode";
      if (toolCalls.length === 0) {
        return routedModel
          ? `Routed via Jev Router to ${targetName}`
          : isStreaming
            ? "Routing via Jev Router…"
            : "Routed via Jev Router";
      }
      return `Routed to ${targetName} · ${buildSummaryText(toolCalls, anyStreaming)}`;
    }
    return buildSummaryText(toolCalls, anyStreaming);
  }, [isAutoRouter, routedModel, isStreaming, toolCalls, anyStreaming]);

  const artifactPreviews = useMemo(() => {
    return toolCalls
      .filter((tc) => tc.result && ARTIFACT_TOOL_NAMES.has(tc.name))
      .map((tc) => parseArtifactFromResult(tc.id, tc.name, tc.result!))
      .filter((a): a is ArtifactPreviewInfo => a !== null);
  }, [toolCalls]);

  const subAgentCalls = toolCalls.filter((tc) => !!tc.subAgentMessage);
  const regularCalls = toolCalls.filter((tc) => !tc.subAgentMessage);

  return (
    <div className="my-1.5">
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1 text-sm text-text-secondary hover:text-foreground transition-colors duration-150"
      >
        <span className={cn(anyStreaming && "animate-pulse")}>{summaryText}</span>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="mt-2 ml-1">
          {isAutoRouter && (
            <RoutingRow
              routedModel={routedModel}
              isStreaming={isStreaming && !routedModel}
              showBottomLine={regularCalls.length > 0 || allDone}
            />
          )}

          {regularCalls.map((tc, i) => {
            const isLast = i === regularCalls.length - 1;
            const showBottomLine = !isLast || allDone;
            return (
              <ToolRow
                key={tc.id}
                toolCall={tc}
                showBottomLine={showBottomLine}
                isStreaming={isStreaming && !tc.result}
              />
            );
          })}

          {allDone && (
            <div className="flex items-center">
              <div className="flex flex-col items-center w-7 shrink-0">
                <div className="w-0.5 h-[10px] rounded-full bg-white/10" />
                <CheckCircle2 className="h-4 w-4 text-text-secondary/60 shrink-0" />
              </div>
              <span className="pl-2.5 text-sm font-medium text-text-secondary/70">
                Done
              </span>
            </div>
          )}
        </div>
      )}

      {/* Artifact preview cards — always visible outside collapse */}
      {artifactPreviews.map((artifact) => (
        <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
      ))}

      {/* Sub-agent panels rendered outside the group */}
      {subAgentCalls.map((tc) => (
        <SubAgentMessageDisplay
          key={tc.id}
          agentName={
            tc.subAgentMessage?.agentName || getDelegatedAgentName(tc.name)
          }
          content={tc.subAgentMessage?.content}
          toolCalls={tc.subAgentMessage?.toolCalls}
          isStreaming={isStreaming && !tc.result}
        />
      ))}
    </div>
  );
}

// ── ToolRow ───────────────────────────────────────────────────────────────────

function ToolRow({
  toolCall,
  showBottomLine,
  isStreaming,
}: {
  toolCall: ToolCall;
  showBottomLine: boolean;
  isStreaming?: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  const cfg = getToolConfig(toolCall.name);
  const Icon = cfg.icon;
  const accent = ACCENT_CLASSES[cfg.accent];

  const hasResult = !!toolCall.result;
  const isError =
    hasResult &&
    (toolCall.result!.startsWith("Error:") ||
      (() => {
        try {
          return !!JSON.parse(toolCall.result!).error;
        } catch {
          return false;
        }
      })());

  const rowLabel = isStreaming
    ? cfg.activeLabel(toolCall.arguments ?? {})
    : cfg.label(toolCall.arguments ?? {});

  // Inline previews (only when not in detail mode)
  const webSearch =
    !detailOpen && toolCall.name === "web_search" && hasResult
      ? parseWebSearchResult(toolCall.result!)
      : null;
  const kbResults =
    !detailOpen && toolCall.name === "knowledge_base_search" && hasResult
      ? parseKBResult(toolCall.result!)
      : null;
  const imageResult =
    !detailOpen &&
    (toolCall.name === "generate_image" || toolCall.name === "edit_image") &&
    hasResult
      ? parseImageResult(toolCall.result!)
      : null;

  return (
    <div className="flex">
      {/* ── Timeline spine ── */}
      <div className="flex flex-col items-center w-7 shrink-0">
        {/* Top connector stub */}
        <div className="w-0.5 h-[10px] rounded-full bg-white/10" />
        {/* Icon badge */}
        <div
          className={cn(
            "h-5 w-5 rounded-md flex items-center justify-center shrink-0 z-10",
            accent.bg,
          )}
        >
          {isStreaming ? (
            <Icon className={cn("h-3 w-3 animate-pulse", accent.text)} />
          ) : isError ? (
            <XCircle className="h-3 w-3 text-red-400" />
          ) : (
            <Icon className={cn("h-3 w-3", accent.text)} />
          )}
        </div>
        {/* Bottom connector — flex-1 fills the rest of this row's height */}
        {showBottomLine ? (
          <div className="w-0.5 flex-1 rounded-full bg-white/10 min-h-[12px]" />
        ) : (
          <div className="h-2" />
        )}
      </div>

      {/* ── Row content ── */}
      <div className="flex-1 pb-2.5 pl-2.5 min-w-0">
        <button
          className="w-full text-left"
          onClick={() => hasResult && setDetailOpen((o) => !o)}
        >
          <div className="flex items-center gap-1.5 py-0.5 min-h-[28px]">
            <span
              className={cn(
                "text-sm leading-snug",
                isError
                  ? "text-red-400"
                  : isStreaming
                    ? "text-text-secondary"
                    : "text-foreground/80",
              )}
            >
              {rowLabel}
            </span>
            {hasResult && !isStreaming && (
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-text-secondary/50 shrink-0 transition-transform duration-150",
                  detailOpen && "rotate-180",
                )}
              />
            )}
          </div>
        </button>

        {/* ── Web search citations preview ── */}
        {webSearch?.citations && webSearch.citations.length > 0 && (
          <div className="mb-2 rounded-md border border-border/20 overflow-hidden text-xs">
            {webSearch.citations.slice(0, 4).map((url, i) => {
              let domain = url;
              try {
                domain = new URL(url).hostname.replace(/^www\./, "");
              } catch {}
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/10 last:border-0 hover:bg-hover-bg/40 transition-colors"
                >
                  <Globe className="h-2.5 w-2.5 text-text-secondary/50 shrink-0" />
                  <span className="text-text-secondary/70 truncate flex-1">
                    {domain}
                  </span>
                </div>
              );
            })}
            {webSearch.citations.length > 4 && (
              <div className="px-2.5 py-1 text-text-secondary/40 bg-secondary/10 border-t border-border/10">
                +{webSearch.citations.length - 4} more sources
              </div>
            )}
          </div>
        )}

        {/* ── Knowledge base results preview ── */}
        {kbResults && kbResults.length > 0 && (
          <div className="mb-2 rounded-md border border-border/20 overflow-hidden text-xs">
            {kbResults.slice(0, 3).map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/10 last:border-0"
              >
                <BookOpen className="h-2.5 w-2.5 text-primary/60 shrink-0" />
                <span className="text-text-secondary/80 truncate flex-1">
                  {r.title}
                </span>
                <span className="text-text-secondary/40 shrink-0 tabular-nums">
                  {Math.round(r.score * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Image result metadata ── */}
        {imageResult && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-primary/60">
            <ImageIcon className="h-3 w-3 shrink-0" />
            <span>
              {imageResult.size}
              {imageResult.format ? ` · ${imageResult.format}` : ""}
              {imageResult.image_url ? " · stored" : ""}
            </span>
          </div>
        )}

        {/* ── Detail panel (click to expand) ── */}
        {detailOpen && hasResult && (
          <div className="mb-2 space-y-1.5">
            <div className="rounded-md border border-border/20 bg-secondary/10 p-2 overflow-x-auto">
              <div className="text-[10px] font-medium text-text-secondary/50 uppercase tracking-wider mb-1">
                Input
              </div>
              <pre className="text-xs text-foreground/50 font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
            <div
              className={cn(
                "rounded-md border p-2 overflow-x-auto",
                isError
                  ? "border-red-900/30 bg-red-950/15"
                  : "border-border/20 bg-secondary/10",
              )}
            >
              <div className="text-[10px] font-medium text-text-secondary/50 uppercase tracking-wider mb-1">
                Result
              </div>
              <pre
                className={cn(
                  "text-xs font-mono whitespace-pre-wrap break-all",
                  isError ? "text-red-400" : "text-foreground/50",
                )}
              >
                {toolCall.result}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ToolCallBlock (standalone, for sub-agent recursive use) ───────────────────

export function ToolCallBlock({ toolCall, isStreaming }: ToolCallBlockProps) {
  if (toolCall.subAgentMessage) {
    return (
      <div className="flex flex-col gap-2">
        <ToolRow
          toolCall={toolCall}
          showBottomLine={false}
          isStreaming={isStreaming}
        />
        <SubAgentMessageDisplay
          agentName={
            toolCall.subAgentMessage.agentName ||
            getDelegatedAgentName(toolCall.name)
          }
          content={toolCall.subAgentMessage.content}
          toolCalls={toolCall.subAgentMessage.toolCalls}
          isStreaming={isStreaming && !toolCall.result}
        />
      </div>
    );
  }
  return (
    <ToolRow
      toolCall={toolCall}
      showBottomLine={false}
      isStreaming={isStreaming}
    />
  );
}

// ── SubAgentMessageDisplay ────────────────────────────────────────────────────

function SubAgentMessageDisplay({
  agentName,
  content,
  toolCalls,
  isStreaming,
}: {
  agentName: string;
  content?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}) {
  const hasNestedContent = !!content || !!toolCalls?.length;

  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/15 bg-primary/8">
        <div className="h-5 w-5 rounded-md bg-primary flex items-center justify-center shrink-0">
          <Bot className="h-3 w-3 text-background" />
        </div>
        <span className="text-sm font-semibold text-foreground">{agentName}</span>
        <span className="ml-1 text-[10px] font-medium text-primary px-1.5 py-0.5 rounded-full bg-primary/15">
          sub-agent
        </span>
      </div>

      <div className="p-3 space-y-3">
        {!hasNestedContent && isStreaming && (
          <div className="text-sm text-primary/70 animate-pulse">
            Working…
          </div>
        )}
        {toolCalls && toolCalls.length > 0 && (
          <ToolCallGroup toolCalls={toolCalls} isStreaming={isStreaming} />
        )}
        {content && (
          <MessageContent content={content} isUser={false} isStreaming={false} />
        )}
      </div>
    </div>
  );
}
