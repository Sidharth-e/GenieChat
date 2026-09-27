"use client";

import { useEffect, useState, useRef } from "react";
import {
  ChevronDown,
  Loader2,
  Info,
  Zap,
  Globe,
  Radio,
  Settings,
  Plus,
  Trash2,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MCPServerConfig, MCPTransportType } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useMCPStore } from "@/lib/stores/mcp";
import { useTools } from "@/hooks/use-tools-queries";
import { useSecrets } from "@/hooks/use-secrets-queries";
import { SecretListDialog } from "@/components/tools/secret-list-dialog";

export const transportOptions = [
  { value: "http", label: "HTTP", icon: Globe },
  { value: "sse", label: "Server-Sent Events (SSE)", icon: Radio },
];

const approvalOptions = [
  { value: "never", label: "Never" },
  { value: "always", label: "Always" },
  { value: "per_tool", label: "Per Tool" },
];

export interface MCPFormData {
  name: string;
  description?: string;
  transportType: MCPTransportType;
  serverUrl?: string;
  headers?: Record<string, string>;
  timeout: number;
  requireApproval: "always" | "never" | "per_tool";
}

interface MCPFormProps {
  initialData?: Partial<MCPServerConfig> | null;
  onSave: (serverData: MCPFormData) => Promise<void>;
  isSaving: boolean;
  title: string;
}

const SECTIONS = [
  { id: "basic-info", label: "Basic Info", icon: Info },
  { id: "transport", label: "Transport", icon: Zap },
  { id: "advanced", label: "Advanced", icon: Settings },
];

type ConfigRowValueType = "text" | "secret";

interface ConfigRow {
  id: string;
  key: string;
  value: string;
  valueType: ConfigRowValueType;
  secretName: string;
}

const LEGACY_ENV_SECRET_REFERENCE_REGEX = /^env\.([A-Za-z0-9_]+)$/;
const LEGACY_INPUT_PLACEHOLDER_REGEX = /^\$\{input:([A-Za-z0-9_]+)\}$/;
const SIMPLE_SECRET_PLACEHOLDER_REGEX = /^\$\{([A-Za-z0-9_]+)\}$/;

function createRowId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createConfigRow(partial?: Partial<ConfigRow>): ConfigRow {
  return {
    id: createRowId(),
    key: "",
    value: "",
    valueType: "text",
    secretName: "",
    ...partial,
  };
}

function extractSecretName(rawValue: string): string | null {
  const value = rawValue.trim();

  const legacyEnvMatch = value.match(LEGACY_ENV_SECRET_REFERENCE_REGEX);
  if (legacyEnvMatch) return legacyEnvMatch[1];

  const legacyInputMatch = value.match(LEGACY_INPUT_PLACEHOLDER_REGEX);
  if (legacyInputMatch) return legacyInputMatch[1];

  const simpleMatch = value.match(SIMPLE_SECRET_PLACEHOLDER_REGEX);
  if (simpleMatch) return simpleMatch[1];

  return null;
}

function parseConfigRows(data?: Record<string, string>): ConfigRow[] {
  if (!data) return [];

  return Object.entries(data).map(([key, value]) => {
    const secretName = extractSecretName(value);

    if (secretName) {
      return createConfigRow({
        key,
        valueType: "secret",
        secretName,
      });
    }

    return createConfigRow({
      key,
      value,
      valueType: "text",
    });
  });
}

function configRowsToRecord(rows: ConfigRow[]): Record<string, string> {
  const result: Record<string, string> = {};

  rows.forEach((row) => {
    const key = row.key.trim();
    if (!key) return;

    if (row.valueType === "secret") {
      const secretName = row.secretName.trim();
      if (!secretName) return;
      result[key] = `\${${secretName}}`;
      return;
    }

    result[key] = row.value.trim();
  });

  return result;
}

export function MCPForm({
  initialData,
  onSave,
  isSaving,
  title,
}: MCPFormProps) {
  const router = useRouter();

  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(
    initialData?.description || "",
  );
  const [transportType, setTransportType] = useState<MCPTransportType>(
    initialData?.transportType === "sse" ? "sse" : "http",
  );
  const [serverUrl, setServerUrl] = useState(initialData?.serverUrl || "");
  const [headerRows, setHeaderRows] = useState<ConfigRow[]>(() =>
    parseConfigRows(initialData?.headers),
  );
  const [timeout, setTimeoutValue] = useState(
    String(initialData?.timeout || 30000),
  );
  const [requireApproval, setRequireApproval] = useState<
    "always" | "never" | "per_tool"
  >(initialData?.requireApproval || "never");
  const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

  const [activeSection, setActiveSection] = useState("basic-info");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Validation
  const [nameError, setNameError] = useState<string | null>(null);

  // Fetch installed servers for validation
  const { servers: installedServers, fetchServers } = useMCPStore();

  // Fetch custom tools for validation
  const { data: customTools } = useTools();
  const { data: secrets = [], isLoading: isLoadingSecrets } = useSecrets();

  useEffect(() => {
    if (installedServers.length === 0) {
      fetchServers();
    }
  }, [fetchServers, installedServers.length]);

  const validateServerName = (serverName: string): string | null => {
    const normalizedName = serverName.trim();
    if (!normalizedName) return "Server name is required";

    // Check against Installed Servers
    const isInstalled = installedServers.some(
      (s) =>
        s.name.toLowerCase() === normalizedName.toLowerCase() &&
        s.id !== initialData?.id,
    );
    if (isInstalled) return "A server with this name already exists.";

    // Check against Custom Tools
    if (customTools) {
      const isCustomTool = customTools.some(
        (t) => t.name.toLowerCase() === normalizedName.toLowerCase(),
      );
      if (isCustomTool)
        return "This name is reserved by a custom tool. Please use a different name.";
    }

    return null;
  };

  const handleSave = async () => {
    const error = validateServerName(name);
    if (error) {
      setNameError(error);
      scrollToSection("basic-info");
      return;
    }
    setNameError(null);

    if (!name.trim()) return;

    const headers = configRowsToRecord(headerRows);

    const serverData = {
      name: name.trim(),
      description: description.trim() || undefined,
      transportType,
      serverUrl: serverUrl.trim(),
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      timeout: parseInt(timeout) || 30000,
      requireApproval,
    };

    await onSave(serverData);
  };

  const addHeaderRow = () =>
    setHeaderRows((prev) => [...prev, createConfigRow({ valueType: "text" })]);

  const updateHeaderRow = (rowId: string, updates: Partial<ConfigRow>) => {
    setHeaderRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
  };

  const removeHeaderRow = (rowId: string) => {
    setHeaderRows((prev) => prev.filter((row) => row.id !== rowId));
  };

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    const container = scrollContainerRef.current;
    if (element && container) {
      const containerTop = container.getBoundingClientRect().top;
      const elementTop = element.getBoundingClientRect().top;
      const scrollOffset =
        container.scrollTop + (elementTop - containerTop) - 20;
      container.scrollTo({ top: scrollOffset, behavior: "smooth" });
      setActiveSection(sectionId);
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      if (!scrollContainerRef.current) return;
      const containerRect = scrollContainerRef.current.getBoundingClientRect();
      const threshold = containerRect.top + 150;

      // Check if we're at the bottom of the container
      const isBottom =
        Math.abs(
          scrollContainerRef.current.scrollHeight -
            scrollContainerRef.current.scrollTop -
            scrollContainerRef.current.clientHeight,
        ) < 50;

      if (isBottom) {
        setActiveSection(SECTIONS[SECTIONS.length - 1].id);
        return;
      }

      let currentSection = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= threshold) {
            currentSection = section.id;
          }
        }
      }
      setActiveSection(currentSection);
    };

    const container = scrollContainerRef.current;
    container?.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => container?.removeEventListener("scroll", handleScroll);
  }, []);

  const activeSectionIndex = SECTIONS.findIndex((s) => s.id === activeSection);

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-hidden font-sans relative z-51">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-input-border px-4 md:px-6 bg-background/95 backdrop-blur-md z-60 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-hover-bg transition-colors text-foreground/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-5 w-px bg-input-border" />
          <h1 className="text-sm font-semibold text-foreground tracking-tight">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {(!name || !serverUrl) && (
            <span className="text-[11px] text-foreground/40 font-medium mr-2 hidden sm:block">
              Name and URL required
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={!name || !serverUrl || isSaving}
            className="h-9 px-5 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg shadow-sm active:scale-[0.98] transition-all disabled:opacity-40 disabled:scale-100"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-white" />
            ) : null}
            {isSaving
              ? "Saving..."
              : initialData?.id
                ? "Update Server"
                : "Add Server"}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar Navigation — step indicator style */}
        <aside className="w-56 border-r border-input-border bg-surface-muted hidden xl:flex flex-col py-6 px-3 z-20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground/35 mb-5 px-3">
            Configuration
          </p>

          <nav className="relative flex-1">
            {/* Vertical progress line */}
            <div className="absolute left-[19px] top-3 bottom-3 w-px bg-input-border" />
            <div
              className="absolute left-[19px] top-3 w-px bg-primary/50 transition-all duration-500 ease-out"
              style={{
                height: `${Math.max(0, (activeSectionIndex / (SECTIONS.length - 1)) * 100)}%`,
                maxHeight: "calc(100% - 24px)",
              }}
            />

            <div className="relative space-y-0.5">
              {SECTIONS.map((section, index) => {
                const isActive = activeSection === section.id;
                const isPast = index < activeSectionIndex;

                return (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={cn(
                      "w-full flex items-center gap-3 pl-2 pr-3 py-2.5 rounded-lg text-[12.5px] font-medium transition-all group text-left relative",
                      isActive
                        ? "text-primary bg-primary/8"
                        : isPast
                          ? "text-foreground/60 hover:text-foreground hover:bg-hover-bg"
                          : "text-foreground/40 hover:text-foreground/60 hover:bg-hover-bg",
                    )}
                  >
                    {/* Step indicator dot */}
                    <div
                      className={cn(
                        "relative z-10 flex items-center justify-center h-6 w-6 rounded-full border-2 transition-all duration-300 shrink-0",
                        isActive
                          ? "border-primary bg-primary text-white scale-110"
                          : isPast
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-input-border bg-background text-foreground/30",
                      )}
                    >
                      {isPast ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <span className="text-[10px] font-bold">
                          {index + 1}
                        </span>
                      )}
                    </div>
                    {section.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="mt-6 mx-1 p-3.5 rounded-xl bg-card-bg border border-card-border">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                Tip
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-foreground/50">
              Extend AI capabilities with Model Context Protocol servers.
            </p>
          </div>
        </aside>

        {/* Middle Form Section */}
        <main
          className="flex-1 overflow-y-auto scroll-smooth relative"
          ref={scrollContainerRef}
        >
          {/* Mobile section nav */}
          <div className="sticky top-0 z-30 border-b border-input-border bg-background/95 backdrop-blur-xl xl:hidden">
            <div className="relative">
              {/* Left fade */}
              <div className="absolute left-0 top-0 bottom-0 w-6 bg-linear-to-r from-background to-transparent z-10 pointer-events-none" />
              {/* Right fade */}
              <div className="absolute right-0 top-0 bottom-0 w-6 bg-linear-to-l from-background to-transparent z-10 pointer-events-none" />
              <div className="px-4 md:px-6 py-2.5 overflow-x-auto hide-scrollbar">
                <div className="flex items-center gap-1.5 min-w-max">
                  {SECTIONS.map((section, index) => {
                    const isActive = activeSection === section.id;
                    const isPast = index < activeSectionIndex;
                    return (
                      <button
                        key={section.id}
                        onClick={() => scrollToSection(section.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                          isActive
                            ? "bg-primary/12 text-primary ring-1 ring-primary/20"
                            : isPast
                              ? "text-foreground/60 hover:text-foreground hover:bg-hover-bg"
                              : "text-foreground/40 hover:text-foreground/60 hover:bg-hover-bg",
                        )}
                      >
                        {isPast ? (
                          <Check className="h-3 w-3 text-primary/60" />
                        ) : (
                          <section.icon className="h-3 w-3" />
                        )}
                        {section.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-4xl mx-auto py-8 md:py-10 px-4 md:px-8 space-y-14 pb-24">
            {/* Basic Info */}
            <section id="basic-info" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Identify Server
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Give your server a name and description.
                </p>
              </div>
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    className={cn(
                      "w-full rounded-2xl border bg-input-bg px-5 py-4 text-sm font-medium outline-none transition-all text-foreground",
                      nameError
                        ? "border-red-500 focus:ring-4 focus:ring-red-500/10"
                        : "border-input-border focus:border-primary focus:ring-4 focus:ring-primary/5",
                    )}
                    placeholder="e.g. File System"
                  />
                  {nameError && (
                    <p className="text-xs font-medium text-red-500 ml-1">
                      {nameError}
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                    placeholder="What this server provides"
                  />
                </div>
              </div>
            </section>

            {/* Transport */}
            <section id="transport" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Transport Layer
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Configure how the interface communicates with the MCP server.
                </p>
              </div>
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Transport Type
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {transportOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setTransportType(option.value as MCPTransportType)
                        }
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all",
                          transportType === option.value
                            ? "bg-input-bg border-primary text-primary"
                            : "bg-transparent border-input-border text-foreground/40 hover:border-foreground/20",
                        )}
                      >
                        <option.icon className="h-5 w-5" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          {option.label.split(" (")[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Server URL
                  </label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                    placeholder="https://example.com/mcp"
                  />
                </div>
              </div>
            </section>

            {/* Advanced */}
            <section id="advanced" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Advanced Settings
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Configure secrets, headers, and execution constraints.
                </p>
              </div>
              <div className="space-y-6">
                <div className="rounded-3xl border border-input-border bg-secondary/30 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-black text-foreground">
                        Use Saved Secret
                      </p>
                      <p className="text-xs font-medium text-foreground/50">
                        Use text values or pick a saved secret. Secret values
                        are stored as ${"{SECRET_NAME}"}.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsSecretDialogOpen(true)}
                      className="rounded-xl"
                    >
                      Manage Secrets
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    HTTP Headers
                  </label>
                  {headerRows.length === 0 ? (
                    <p className="text-xs font-medium text-foreground/50 ml-1">
                      No headers yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {headerRows.map((row) => (
                        <div
                          key={row.id}
                          className="grid gap-3 sm:grid-cols-4 items-center"
                        >
                          <input
                            type="text"
                            value={row.key}
                            onChange={(e) =>
                              updateHeaderRow(row.id, { key: e.target.value })
                            }
                            className="w-full rounded-2xl border border-input-border bg-input-bg px-4 py-3 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                            placeholder="Header (e.g. Authorization)"
                          />
                          <Select
                            value={row.valueType}
                            onChange={(v) => {
                              const nextType = v as ConfigRowValueType;
                              updateHeaderRow(row.id, {
                                valueType: nextType,
                                value: nextType === "text" ? row.value : "",
                                secretName:
                                  nextType === "secret" ? row.secretName : "",
                              });
                            }}
                            options={[
                              { value: "text", label: "Text Value" },
                              { value: "secret", label: "Saved Secret", disabled: secrets.length === 0 },
                            ]}
                          />
                          {row.valueType === "secret" ? (
                            <Select
                              value={row.secretName}
                              onChange={(v) =>
                                updateHeaderRow(row.id, { secretName: v })
                              }
                              disabled={isLoadingSecrets || secrets.length === 0}
                              placeholder={
                                isLoadingSecrets
                                  ? "Loading saved secrets..."
                                  : secrets.length === 0
                                    ? "No saved secrets found"
                                    : "Select saved secret"
                              }
                              options={secrets.map((secret) => ({
                                value: secret.name,
                                label: secret.name,
                              }))}
                            />
                          ) : (
                            <input
                              type="text"
                              value={row.value}
                              onChange={(e) =>
                                updateHeaderRow(row.id, {
                                  value: e.target.value,
                                })
                              }
                              className="w-full rounded-2xl border border-input-border bg-input-bg px-4 py-3 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                              placeholder="Value"
                            />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeHeaderRow(row.id)}
                            className="h-10 w-10 rounded-xl hover:bg-input-bg justify-self-end"
                          >
                            <Trash2 className="h-4 w-4 text-foreground/60" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={addHeaderRow}
                    className="rounded-xl"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Header
                  </Button>
                </div>
                <div className="grid gap-8 sm:grid-cols-2">
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={timeout}
                      onChange={(e) => setTimeoutValue(e.target.value)}
                      className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                      Tool Approval
                    </label>
                    <Select
                      value={requireApproval}
                      onChange={(v) =>
                        setRequireApproval(v as "always" | "never" | "per_tool")
                      }
                      options={approvalOptions.map((opt) => ({
                        value: opt.value,
                        label: opt.label,
                      }))}
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
      <SecretListDialog
        isOpen={isSecretDialogOpen}
        onClose={() => setIsSecretDialogOpen(false)}
      />
    </div>
  );
}

