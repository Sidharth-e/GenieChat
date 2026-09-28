"use client";

import { useState, useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  X,
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  Cpu,
  Layers,
  Terminal,
  FileText,
  Clock,
  Sparkles,
  ArrowRightLeft,
} from "lucide-react";
import { useMachineStateStore, useChatSettings, useDraftStore } from "@/lib/stores";
import { useThreadMessages } from "@/hooks/use-threads-queries";
import { useAgents } from "@/hooks/use-agents-queries";
import { useModels } from "@/hooks/use-models-queries";
import { defaultSystemPrompt } from "@/constants/prompt";
import {
  AVAILABLE_MODELS,
  JEV_ROUTER_MODEL_ID,
  formatModelName,
} from "@/lib/langchain/model-config";
import { ModelConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ToolItem {
  id: string;
  name: string;
  args: Record<string, unknown> | string;
  result?: string;
  status: "completed" | "running" | "error";
  time?: string;
}

interface ContextFileItem {
  id: string;
  name: string;
  type: string;
  done: boolean;
  detail?: string;
}

interface AuditItem {
  id: string;
  time: string;
  action: string;
  detail?: string;
  type?: string;
}

export function MachineStatePanel() {
  const pathname = usePathname();
  const {
    isOpen,
    close,
    machineStatus,
    liveToolName,
    liveTokens,
    liveRoutedModel,
    liveAuditLogs,
    activeMessages,
    activeThreadId,
    clearLiveLogs,
  } = useMachineStateStore();

  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  const chatMatch = pathname?.match(/^\/chat\/([^/]+)/);
  const agentChatMatch = pathname?.match(/^\/agent-chat\/([^/]+)(?:\/([^/]+))?/);
  const multiAgentChatMatch = pathname?.match(
    /^\/multi-agent-chat\/([^/]+)(?:\/([^/]+))?/,
  );
  const swarmChatMatch = pathname?.match(/^\/swarm-chat\/([^/]+)/);

  const routeThreadId =
    chatMatch?.[1] ||
    agentChatMatch?.[2] ||
    multiAgentChatMatch?.[2] ||
    swarmChatMatch?.[1];

  const threadId = routeThreadId || activeThreadId || undefined;
  const agentId = agentChatMatch?.[1] || multiAgentChatMatch?.[1];

  const { selectedModel, selectedAgentId } = useChatSettings();
  const effectiveAgentId = agentId || selectedAgentId || undefined;

  const { data: serverMessages = [] } = useThreadMessages(threadId);
  const messages = activeMessages.length > 0 ? activeMessages : serverMessages;

  const { data: agents = [] } = useAgents(undefined, {
    enabled: Boolean(effectiveAgentId),
  });
  const { data: models = AVAILABLE_MODELS } = useModels();

  const drafts = useDraftStore((s) => s.drafts);
  const contextKey = threadId ? `thread-${threadId}` : "new-chat";
  const currentDraft = drafts[contextKey] || drafts["new-chat"] || drafts["default"];

  const currentAgent = useMemo(
    () => agents.find((a) => a.id === effectiveAgentId),
    [agents, effectiveAgentId],
  );

  const activeModelId = useMemo(() => {
    if (currentAgent?.modelId) return currentAgent.modelId;
    return selectedModel;
  }, [currentAgent, selectedModel]);

  const activeModel = useMemo<ModelConfig>(() => {
    const found =
      models.find((m) => m.id === activeModelId) ||
      AVAILABLE_MODELS.find((m) => m.id === activeModelId);
    if (found) return found;

    return {
      id: activeModelId,
      name: activeModelId,
      provider: "google",
      model: activeModelId,
      description: "AI Model",
      maxInputChars: 100000,
      maxOutput: 65536,
      supportsStreaming: true,
      supportsTools: true,
      supportsTemperature: true,
      supportsTopP: true,
      supportReasoning: false,
    };
  }, [models, activeModelId]);

  const effectiveSystemPrompt = useMemo(() => {
    if (currentAgent?.systemPrompt) return currentAgent.systemPrompt;
    return defaultSystemPrompt;
  }, [currentAgent]);

  const promptStats = useMemo(() => {
    const chars = effectiveSystemPrompt.length;
    const estimatedTokens = Math.ceil(chars / 4);
    return { chars, estimatedTokens };
  }, [effectiveSystemPrompt]);

  const tokenUsage = useMemo(() => {
    const cumulative = messages.reduce(
      (acc, m, idx) => {
        let p = m.tokens?.prompt ?? 0;
        let c = m.tokens?.completion ?? 0;

        if (m.toolCalls && m.toolCalls.length > 0) {
          for (const tc of m.toolCalls) {
            if (tc.tokens) {
              p += tc.tokens.prompt ?? 0;
              c += tc.tokens.completion ?? 0;
            }
          }
        }

        if (m.role === "assistant") {
          if (c === 0 && m.content) {
            c = Math.max(1, Math.ceil(m.content.length / 4));
          }
        } else if (m.role === "user") {
          const nextMsg = messages[idx + 1];
          const nextHasPromptTokens = (nextMsg?.tokens?.prompt ?? 0) > 0;
          if (!nextHasPromptTokens && m.content) {
            p = Math.max(1, Math.ceil(m.content.length / 4));
          }
        }

        return {
          prompt: acc.prompt + p,
          completion: acc.completion + c,
          total: acc.total + p + c,
        };
      },
      { prompt: 0, completion: 0, total: 0 },
    );

    if (
      liveTokens &&
      (machineStatus === "streaming" || machineStatus === "executing_tool")
    ) {
      return {
        prompt: Math.max(cumulative.prompt, liveTokens.prompt),
        completion: cumulative.completion + liveTokens.completion,
        total: cumulative.total + liveTokens.completion,
      };
    }

    return cumulative;
  }, [messages, liveTokens, machineStatus]);

  const toolsList = useMemo<ToolItem[]>(() => {
    const list: ToolItem[] = [];

    if (liveToolName && machineStatus === "executing_tool") {
      list.push({
        id: "live-tool-running",
        name: liveToolName,
        args: {},
        status: "running",
        time: new Date().toTimeString().split(" ")[0],
      });
    }

    for (const msg of messages) {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          list.push({
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            result: tc.result,
            status: tc.result ? "completed" : "running",
            time: msg.createdAt
              ? new Date(msg.createdAt).toTimeString().split(" ")[0]
              : undefined,
          });
        }
      }
    }

    return list;
  }, [messages, liveToolName, machineStatus]);

  const contextFiles = useMemo<ContextFileItem[]>(() => {
    const files: ContextFileItem[] = [];
    const seenNames = new Set<string>();

    for (const msg of messages) {
      if (msg.documents) {
        for (const doc of msg.documents) {
          if (!seenNames.has(doc.fileName)) {
            seenNames.add(doc.fileName);
            files.push({
              id: doc.id,
              name: doc.fileName,
              type: "document",
              done: true,
              detail: doc.extractedTextRef ? "Parsed & indexed" : "Attached",
            });
          }
        }
      }
      if (msg.images) {
        for (const img of msg.images) {
          const name = img.fileName || "Image";
          if (!seenNames.has(name)) {
            seenNames.add(name);
            files.push({
              id: img.id,
              name,
              type: "image",
              done: true,
              detail: img.mimeType || "image",
            });
          }
        }
      }
    }

    if (currentDraft?.attachments) {
      for (const att of currentDraft.attachments) {
        if (!seenNames.has(att.fileName)) {
          seenNames.add(att.fileName);
          files.push({
            id: att.id,
            name: att.fileName,
            type: att.type,
            done: false,
            detail: "Draft / Pending",
          });
        }
      }
    }

    return files;
  }, [messages, currentDraft]);

  const auditTrail = useMemo<AuditItem[]>(() => {
    const history: AuditItem[] = [];

    for (const msg of messages) {
      const timeStr = msg.createdAt
        ? new Date(msg.createdAt).toTimeString().split(" ")[0]
        : "00:00:00";

      if (msg.role === "user") {
        history.push({
          id: `msg-${msg.id}`,
          time: timeStr,
          action: "User prompt received",
          detail:
            msg.content.length > 60
              ? `${msg.content.slice(0, 60)}...`
              : msg.content,
          type: "user",
        });

        if (msg.documents && msg.documents.length > 0) {
          for (const doc of msg.documents) {
            history.push({
              id: `doc-${doc.id}`,
              time: timeStr,
              action: `Parsed ${doc.fileName}`,
              detail: doc.extractedTextRef
                ? "Document indexed into context"
                : "Attached file",
              type: "system",
            });
          }
        }
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            history.push({
              id: `tool-${tc.id}`,
              time: timeStr,
              action: `Executed tool: ${tc.name}`,
              detail:
                typeof tc.result === "string"
                  ? `${tc.result.slice(0, 50)}...`
                  : "Completed",
              type: "tool",
            });
          }
        }

        const tokenText = msg.tokens
          ? `${msg.tokens.prompt + msg.tokens.completion} tokens (${msg.tokens.prompt} in / ${msg.tokens.completion} out)`
          : undefined;

        const routedInfo = msg.routedModel
          ? ` → ${formatModelName(msg.routedModel)}`
          : "";
        history.push({
          id: `asst-${msg.id}`,
          time: timeStr,
          action: `Generated response (${msg.model || activeModel.name}${routedInfo})`,
          detail: tokenText,
          type: "model",
        });
      }
    }

    const merged = [...history, ...liveAuditLogs];
    return merged.slice(-50);
  }, [messages, liveAuditLogs, activeModel]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(effectiveSystemPrompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      setCopiedPrompt(false);
    }
  };

  const statusLabel = useMemo(() => {
    switch (machineStatus) {
      case "streaming":
        return "Streaming";
      case "executing_tool":
        return liveToolName ? `Tool: ${liveToolName}` : "Calling Tool";
      case "thinking":
        return "Thinking";
      case "error":
        return "Error";
      case "idle":
      default:
        return "Idle";
    }
  }, [machineStatus, liveToolName]);

  const statusColorClass = useMemo(() => {
    switch (machineStatus) {
      case "streaming":
        return "text-[var(--blue)]";
      case "executing_tool":
        return "text-[var(--amber)]";
      case "thinking":
        return "text-[var(--purple)]";
      case "error":
        return "text-[var(--red)]";
      case "idle":
      default:
        return "text-[var(--green)]";
    }
  }, [machineStatus]);

  const statusDotClass = useMemo(() => {
    switch (machineStatus) {
      case "streaming":
        return "bg-[var(--blue)] animate-pulse";
      case "executing_tool":
        return "bg-[var(--amber)] animate-pulse";
      case "thinking":
        return "bg-[var(--purple)] animate-pulse";
      case "error":
        return "bg-[var(--red)]";
      case "idle":
      default:
        return "bg-[var(--green)] animate-pulse";
    }
  }, [machineStatus]);

  return (
    <aside
      className={cn(
        "bg-card-bg border-l border-card-border transition-all duration-300 flex flex-col shrink-0 z-30",
        "absolute right-0 top-0 h-full md:relative",
        isOpen
          ? "w-80 sm:w-88 translate-x-0"
          : "w-0 translate-x-full md:translate-x-0 overflow-hidden border-l-0 pointer-events-none opacity-0 md:opacity-0",
      )}
    >
      <div className="h-12 px-4 border-b border-card-border flex items-center justify-between shrink-0">
        <h3 className="font-mono text-[10px] uppercase tracking-widest font-medium text-foreground">
          Machine State
        </h3>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex items-center gap-1.5 font-mono text-[10px]",
              statusColorClass,
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", statusDotClass)} />
            <span className="truncate max-w-[120px]">{statusLabel}</span>
          </span>
          <button
            onClick={close}
            className="text-tertiary/40 hover:text-foreground cursor-pointer"
            aria-label="Close machine state panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 font-mono text-[10px] text-tertiary/70">
        <div>
          <div className="flex items-center justify-between mb-2 border-b border-card-border pb-1">
            <h4 className="font-sans text-xs text-foreground flex items-center gap-1.5 font-medium">
              <Cpu className="w-3.5 h-3.5 text-tertiary/50" />
              Active Model
            </h4>
            <span className="text-[9px] uppercase tracking-wider text-tertiary/40">
              {activeModel.provider}
            </span>
          </div>
          <div className="bg-tertiary/5 border border-card-border rounded-xs p-2.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-foreground font-sans text-xs font-medium block truncate">
                  {activeModel.name}
                </span>
                <span className="text-tertiary/50 text-[10px] block truncate">
                  {activeModel.id}
                </span>
              </div>
              {activeModel.supportReasoning && (
                <span className="shrink-0 bg-tertiary/10 text-foreground text-[9px] px-1.5 py-0.5 rounded-xs flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  Reasoning
                </span>
              )}
            </div>

            {activeModel.description && (
              <p className="text-tertiary/50 text-[10px] line-clamp-2 leading-relaxed">
                {activeModel.description}
              </p>
            )}

            {(activeModel.id === JEV_ROUTER_MODEL_ID || Boolean(liveRoutedModel)) && (
              <div className="flex items-center justify-between rounded-xs border border-primary/20 bg-primary/10 px-2 py-1.5 text-[10px]">
                <span className="text-primary font-medium flex items-center gap-1">
                  <ArrowRightLeft className="w-3 h-3" />
                  Routed Target
                </span>
                <span className="text-foreground font-semibold truncate max-w-[150px]">
                  {liveRoutedModel
                    ? formatModelName(liveRoutedModel)
                    : "Routing…"}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[9px] text-tertiary/50">
              {activeModel.supportsStreaming && (
                <span className="bg-tertiary/5 border border-card-border px-1.5 py-0.5 rounded-xs">
                  Streaming
                </span>
              )}
              {activeModel.supportsTools && (
                <span className="bg-tertiary/5 border border-card-border px-1.5 py-0.5 rounded-xs">
                  Tools API
                </span>
              )}
              {activeModel.maxOutput && (
                <span className="bg-tertiary/5 border border-card-border px-1.5 py-0.5 rounded-xs">
                  Max Out: {activeModel.maxOutput.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 border-b border-card-border pb-1">
            <h4 className="font-sans text-xs text-foreground flex items-center gap-1.5 font-medium">
              <Layers className="w-3.5 h-3.5 text-tertiary/50" />
              Token Usage
            </h4>
            <span className="text-[9px] text-tertiary/40">
              {messages.length} msgs
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <div className="bg-tertiary/5 border border-card-border rounded-xs p-2 text-center">
              <span className="text-[9px] text-tertiary/40 block mb-0.5 uppercase tracking-wider">
                Prompt
              </span>
              <span className="text-foreground text-xs font-semibold block">
                {tokenUsage.prompt.toLocaleString()}
              </span>
            </div>
            <div className="bg-tertiary/5 border border-card-border rounded-xs p-2 text-center">
              <span className="text-[9px] text-tertiary/40 block mb-0.5 uppercase tracking-wider">
                Output
              </span>
              <span className="text-foreground text-xs font-semibold block">
                {tokenUsage.completion.toLocaleString()}
              </span>
            </div>
            <div className="bg-tertiary/5 border border-card-border rounded-xs p-2 text-center">
              <span className="text-[9px] text-tertiary/40 block mb-0.5 uppercase tracking-wider">
                Total
              </span>
              <span className="text-foreground text-xs font-semibold block">
                {tokenUsage.total.toLocaleString()}
              </span>
            </div>
          </div>
          {liveTokens &&
            (machineStatus === "streaming" ||
              machineStatus === "executing_tool") && (
              <div className="flex items-center justify-between px-2 py-1 bg-tertiary/5 border border-card-border rounded-xs text-[9px]">
                <span className="text-[var(--blue)] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)] animate-pulse" />
                  Generating...
                </span>
                <span className="text-foreground font-mono">
                  +{liveTokens.completion} tokens
                </span>
              </div>
            )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 border-b border-card-border pb-1">
            <h4 className="font-sans text-xs text-foreground flex items-center gap-1.5 font-medium">
              <FileText className="w-3.5 h-3.5 text-tertiary/50" />
              System Prompt
            </h4>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-tertiary/40">
                ~{promptStats.estimatedTokens.toLocaleString()} tok
              </span>
              <button
                onClick={handleCopyPrompt}
                className="text-tertiary/40 hover:text-foreground cursor-pointer"
                title="Copy system prompt"
                aria-label="Copy system prompt"
              >
                {copiedPrompt ? (
                  <Check className="w-3 h-3 text-[var(--green)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
          <div className="bg-tertiary/5 border border-card-border rounded-xs p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[9px] text-tertiary/50">
              <span>{currentAgent ? `Agent: ${currentAgent.name}` : "GenieChat System"}</span>
              <span>{promptStats.chars.toLocaleString()} chars</span>
            </div>
            <div
              className={cn(
                "font-mono text-[9px] text-tertiary/60 leading-relaxed whitespace-pre-wrap break-words transition-all duration-200",
                isPromptExpanded ? "max-h-64 overflow-y-auto" : "line-clamp-3",
              )}
            >
              {effectiveSystemPrompt}
            </div>
            <button
              onClick={() => setIsPromptExpanded((prev) => !prev)}
              className="text-[9px] text-foreground/80 hover:text-foreground cursor-pointer flex items-center gap-1 pt-1"
            >
              {isPromptExpanded ? (
                <>
                  <ChevronDown className="w-3 h-3" /> Collapse prompt
                </>
              ) : (
                <>
                  <ChevronRight className="w-3 h-3" /> Expand prompt
                </>
              )}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 border-b border-card-border pb-1">
            <h4 className="font-sans text-xs text-foreground flex items-center gap-1.5 font-medium">
              <Terminal className="w-3.5 h-3.5 text-tertiary/50" />
              Tool Calling
            </h4>
            <span className="text-[9px] text-tertiary/40">
              {toolsList.length} calls
            </span>
          </div>
          {toolsList.length === 0 ? (
            <p className="text-tertiary/40 italic py-1">
              No tools invoked in this session
            </p>
          ) : (
            <div className="space-y-2">
              {toolsList.map((tool) => {
                const isExpanded = expandedToolId === tool.id;
                return (
                  <div
                    key={tool.id}
                    className="border border-card-border rounded-xs bg-tertiary/5 p-2 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() =>
                          setExpandedToolId(isExpanded ? null : tool.id)
                        }
                        className="flex items-center gap-1 text-foreground font-medium hover:underline cursor-pointer truncate"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3 text-tertiary/40 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-tertiary/40 shrink-0" />
                        )}
                        <span className="truncate">{tool.name}</span>
                      </button>
                      <span
                        className={cn(
                          "text-[9px] px-1.5 py-0.2 rounded-xs shrink-0",
                          tool.status === "running" &&
                            "text-[var(--amber)] bg-tertiary/10 animate-pulse",
                          tool.status === "completed" &&
                            "text-[var(--green)] bg-tertiary/10",
                          tool.status === "error" &&
                            "text-[var(--red)] bg-tertiary/10",
                        )}
                      >
                        {tool.status}
                      </span>
                    </div>

                    {tool.time && (
                      <span className="block text-[9px] text-tertiary/40">
                        {tool.time}
                      </span>
                    )}

                    {isExpanded && (
                      <div className="space-y-1.5 pt-1.5 border-t border-card-border">
                        <div>
                          <span className="text-[9px] text-tertiary/40 block">
                            Arguments:
                          </span>
                          <pre className="bg-background/80 p-1.5 rounded-xs overflow-x-auto text-[9px] text-tertiary/70 font-mono">
                            {typeof tool.args === "object"
                              ? JSON.stringify(tool.args, null, 2)
                              : String(tool.args)}
                          </pre>
                        </div>
                        {tool.result && (
                          <div>
                            <span className="text-[9px] text-tertiary/40 block">
                              Result:
                            </span>
                            <pre className="bg-background/80 p-1.5 rounded-xs overflow-x-auto text-[9px] text-tertiary/70 font-mono max-h-32 overflow-y-auto">
                              {tool.result}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 border-b border-card-border pb-1">
            <h4 className="font-sans text-xs text-foreground flex items-center gap-1.5 font-medium">
              <Layers className="w-3.5 h-3.5 text-tertiary/50" />
              Context Window
            </h4>
            <span className="text-[9px] text-tertiary/40">
              {contextFiles.length} files
            </span>
          </div>
          {contextFiles.length === 0 ? (
            <p className="text-tertiary/40 italic py-1">
              0 attached files in context
            </p>
          ) : (
            <ul className="space-y-2">
              {contextFiles.map((file) => (
                <li
                  key={file.id}
                  className={cn(
                    "flex items-center justify-between gap-2",
                    !file.done && "opacity-60",
                  )}
                >
                  <div className="min-w-0">
                    <span className="truncate block text-foreground">
                      {file.name}
                    </span>
                    {file.detail && (
                      <span className="text-[9px] text-tertiary/40 block truncate">
                        {file.detail}
                      </span>
                    )}
                  </div>
                  {file.done ? (
                    <Check className="w-3.5 h-3.5 text-[var(--green)] shrink-0" />
                  ) : (
                    <span className="text-[9px] text-[var(--amber)] shrink-0">
                      pending
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 border-b border-card-border pb-1">
            <h4 className="font-sans text-xs text-foreground flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-tertiary/50" />
              Audit Trail
            </h4>
            {liveAuditLogs.length > 0 && (
              <button
                onClick={clearLiveLogs}
                className="text-[9px] text-tertiary/40 hover:text-foreground cursor-pointer"
              >
                Clear Live
              </button>
            )}
          </div>
          {auditTrail.length === 0 ? (
            <p className="text-tertiary/40 italic py-1">
              No audit logs recorded yet
            </p>
          ) : (
            <div className="space-y-3">
              {auditTrail.map((item) => (
                <div key={item.id} className="border-l border-card-border pl-2">
                  <span className="block text-tertiary/40 mb-1">
                    {item.time}
                  </span>
                  <span className="text-foreground block">{item.action}</span>
                  {item.detail && (
                    <span className="text-tertiary/40 block mt-1 break-words">
                      {item.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
