"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, useRef } from "react";
import {
  Wrench,
  Loader2,
  Info,
  Zap,
  Code,
  Settings,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { CodeEditor } from "@/components/ui/code-editor";
import { cn } from "@/lib/utils";
import { CustomTool } from "@/lib/types";
import { useRouter } from "next/navigation";
import { generateToolAction } from "@/lib/ai-actions/tool-actions";
import { ToolGeneratorDialog } from "./tool-generator-dialog";
import { Wand2 } from "lucide-react";
import { DEFAULT_TOOLS_METADATA } from "@/lib/tool/default-tools-metadata";
import { useTools } from "@/hooks/use-tools-queries";
import { useMCPServers } from "@/hooks/use-mcp-queries";
import { useSecrets } from "@/hooks/use-secrets-queries";
import { SecretListDialog } from "./secret-list-dialog";
import { AI_NAME } from "@/constants/main";

interface ToolFormProps {
  initialData?: CustomTool | null;
  onSave: (toolData: Partial<CustomTool>) => Promise<void>;
  isSaving: boolean;
  title: string;
}

const SECTIONS = [
  { id: "tool-basic-info", label: "Basic Info", icon: Info },
  { id: "tool-logic", label: "Logic", icon: Code },
  { id: "tool-config", label: "Configuration", icon: Settings },
];

export function ToolForm({
  initialData,
  onSave,
  isSaving,
  title,
}: ToolFormProps) {
  const router = useRouter();

  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(
    initialData?.description || "",
  );
  const [category, setCategory] = useState(initialData?.category || "Utility");
  const [code, setCode] = useState(initialData?.code || "");
  const [parameters, setParameters] = useState(
    initialData?.parameters
      ? JSON.stringify(initialData.parameters, null, 2)
      : "[]",
  );
  const [isPublic, setIsPublic] = useState(initialData?.isPublic ?? false);
  const [selectedSecretName, setSelectedSecretName] = useState("");
  const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

  const [activeSection, setActiveSection] = useState("tool-basic-info");

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Generator State
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [generatorQuery, setGeneratorQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Validation State
  const [nameError, setNameError] = useState<string | null>(null);

  // Fetch existing tools for validation
  const { data: existingTools } = useTools();
  const { data: secrets = [], isLoading: isLoadingSecrets } = useSecrets();

  // Fetch installed MCP servers for validation
  const { data: installedMcpServers = [] } = useMCPServers();

  const validateToolName = (toolName: string): string | null => {
    const normalizedName = toolName.trim();
    if (!normalizedName) return "Tool name is required";

    // Check against Default Tools
    const isDefaultTool = DEFAULT_TOOLS_METADATA.some(
      (t) => t.name.toLowerCase() === normalizedName.toLowerCase(),
    );
    if (isDefaultTool) return "This name is reserved by a default system tool.";

    // Check against Installed MCP Tools
    const isInstalledMcpTool = installedMcpServers.some(
      (s) => s.name.toLowerCase() === normalizedName.toLowerCase(),
    );
    if (isInstalledMcpTool)
      return "This name is reserved by an installed connector.";

    // Check against User Tools (exclude current tool if editing)
    if (existingTools) {
      const isDuplicateUserTool = existingTools.some(
        (t) =>
          t.name.toLowerCase() === normalizedName.toLowerCase() &&
          t.id !== initialData?.id,
      );
      if (isDuplicateUserTool)
        return "A custom tool with this name already exists.";
    }

    return null;
  };

  // Sync form state when initialData changes (e.g., after fetch completes or cache updates)
  useEffect(() => {
    if (initialData) {
      setName(initialData.name || "");
      setDescription(initialData.description || "");
      setCategory(initialData.category || "Utility");
      setCode(initialData.code || "");
      setParameters(
        initialData.parameters
          ? JSON.stringify(initialData.parameters, null, 2)
          : "[]",
      );
      setIsPublic(initialData.isPublic ?? false);
    }
  }, [initialData]);

  const handleSave = async () => {
    const validationError = validateToolName(name);
    if (validationError) {
      setNameError(validationError);
      // Scroll to basic info if error exists
      scrollToSection("tool-basic-info");
      return;
    }
    setNameError(null);

    if (!name.trim() || !code.trim()) return;

    let parsedParams;
    try {
      parsedParams = JSON.parse(parameters);
    } catch {
      alert("Invalid JSON for parameters");
      return;
    }

    const toolData = {
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      code: code.trim(),
      parameters: parsedParams,
      isPublic,
      enabled: initialData?.enabled ?? true,
    };

    await onSave(toolData);
  };

  const handleInsertSecretReference = () => {
    if (!selectedSecretName) return;

    const secretReference = `env.${selectedSecretName}`;
    if (code.includes(secretReference)) return;

    if (!code.trim()) {
      setCode(
        `async function handle(params) {\n  const apiKey = ${secretReference};\n  // Your logic here\n  return { success: true };\n}`,
      );
      return;
    }

    setCode(
      `${code}\n\n// Saved API secret\nconst apiKey = ${secretReference};`,
    );
  };

  const handleGenerate = async () => {
    if (!generatorQuery) return;

    setIsGenerating(true);
    try {
      const result = await generateToolAction(generatorQuery);
      if (result) {
        setName(result.name);
        setDescription(result.description);
        setCategory(result.category);
        setCode(result.code);
        setParameters(JSON.stringify(result.parameters, null, 2));

        setIsGeneratorOpen(false);
        setGeneratorQuery("");
      }
    } catch (error) {
      logger.error("Tool generation failed:", error);
    } finally {
      setIsGenerating(false);
    }
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsGeneratorOpen(true)}
            className="h-9 px-4 font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-all mr-2"
          >
            <Wand2 className="mr-2 h-4 w-4" />
            {AI_NAME} Assist
          </Button>
          {(!name || !code) && (
            <span className="text-[11px] text-foreground/40 font-medium mr-2 hidden sm:block">
              Name and code required
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={!name || !code || isSaving}
            className="h-9 px-5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg shadow-sm active:scale-[0.98] transition-all disabled:opacity-40 disabled:scale-100"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary-foreground" />
            ) : null}
            {isSaving
              ? "Saving..."
              : initialData
                ? "Update Tool"
                : "Create Tool"}
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
                          ? "border-primary bg-primary text-primary-foreground scale-110"
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
              <Wrench className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                Tip
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-foreground/50">
              Create custom tools to extend AI capabilities with your own logic.
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
            <section id="tool-basic-info" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Basic Info
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Name and describe your custom tool.
                </p>
              </div>
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Tool Name
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
                    placeholder="e.g. Weather Checker"
                  />
                  {nameError && (
                    <p className="text-xs font-medium text-red-500 ml-1">
                      {nameError}
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                    placeholder="Utility, Data, etc."
                  />
                </div>
                <div className="space-y-3 sm:col-span-2">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                    placeholder="What this tool does..."
                  />
                </div>
              </div>
            </section>

            {/* Logic */}
            <section id="tool-logic" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Logic
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Implement the tool&apos;s behavior using JavaScript.
                </p>
              </div>
              <div className="rounded-3xl border border-input-border bg-secondary/30 p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-foreground">
                      Use Saved API
                    </p>
                    <p className="text-xs font-medium text-foreground/50">
                      Insert a secret reference in code as{" "}
                      <code>env.SECRET_NAME</code>.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSecretDialogOpen(true)}
                    className="rounded-xl"
                  >
                    Manage APIs
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Select
                    value={selectedSecretName}
                    onChange={(v) => setSelectedSecretName(v)}
                    disabled={isLoadingSecrets || secrets.length === 0}
                    placeholder={
                      isLoadingSecrets
                        ? "Loading saved APIs..."
                        : secrets.length === 0
                          ? "No saved APIs found"
                          : "Select saved API secret"
                    }
                    options={secrets.map((secret) => ({
                      value: secret.name,
                      label: secret.name,
                    }))}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleInsertSecretReference}
                    disabled={!selectedSecretName}
                    className="rounded-xl"
                  >
                    Insert Reference
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <CodeEditor
                  value={code}
                  onChange={setCode}
                  language="javascript"
                  height="350px"
                  placeholder={
                    "async function handle(params) {\n  // Your logic here\n  return { success: true };\n}"
                  }
                />
              </div>
            </section>

            {/* Configuration */}
            <section id="tool-config" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Configuration
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Parameters schema and visibility.
                </p>
              </div>
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                    Parameter Schema (JSON)
                  </label>
                  <CodeEditor
                    value={parameters}
                    onChange={setParameters}
                    language="json"
                    height="200px"
                    placeholder={
                      '[\n  {\n    "name": "paramName",\n    "type": "string",\n    "description": "Description...",\n    "required": true\n  }\n]'
                    }
                  />
                </div>
                <div className="flex items-center gap-4 p-5 rounded-3xl bg-secondary/30 border border-input-border transition-all hover:border-primary/30">
                  <input
                    type="checkbox"
                    id="isPublic"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="h-5 w-5 rounded-lg border-2 border-input-border bg-input-bg text-primary focus:ring-primary/5 transition-all cursor-pointer"
                  />
                  <label htmlFor="isPublic" className="flex-1 cursor-pointer">
                    <p className="text-sm font-black text-foreground">
                      Public Visibility
                    </p>
                    <p className="text-[12px] font-medium text-foreground/50">
                      Allow other users to see and use this tool.
                    </p>
                  </label>
                  <Zap
                    className={cn(
                      "h-5 w-5 transition-all",
                      isPublic
                        ? "text-primary fill-primary animate-pulse"
                        : "text-foreground/20",
                    )}
                  />
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
      <ToolGeneratorDialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        query={generatorQuery}
        setQuery={setGeneratorQuery}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
      />
      <SecretListDialog
        isOpen={isSecretDialogOpen}
        onClose={() => setIsSecretDialogOpen(false)}
      />
    </div>
  );
}
