"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, useRef, useMemo } from "react";
import {
  Bot,
  Loader2,
  ArrowLeft,
  Wand2,
  Info,
  Settings,
  Zap,
  Wrench,
  BookOpen,
  Layout,
  Users,
  Check,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Agent, AgentDocument, AgentSkill } from "@/lib/types";
import { useMCPStore } from "@/lib/stores";
import { useTools } from "@/hooks/use-tools-queries";
import { TargetSchedules } from "@/components/schedules/target-schedules";
import { DocumentUploadSection } from "./document-upload-section";
import { useRouter } from "next/navigation";
import {
  generateAgentAction,
  type AgentSubAgentOption,
  generateSystemPromptAction,
  type AgentModelOption,
  type AgentToolOption,
} from "@/lib/ai-actions/agent-actions";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { AgentGeneratorDialog } from "./agent-generator-dialog";
import { DEFAULT_TOOLS_METADATA } from "@/lib/tool/default-tools-metadata";

// Form Sections
import { BasicInfoSection } from "./form-sections/basic-info-section";
import { BehaviorSection } from "./form-sections/behavior-section";
import { SystemToolsSection } from "./form-sections/system-tools-section";
import { CustomToolsSection } from "./form-sections/custom-tools-section";
import { McpToolsSection } from "./form-sections/mcp-tools-section";
import { PromptDialog } from "./form-sections/prompt-dialog";
import { VariableDialog } from "./form-sections/variable-dialog";
import { SubAgentsSection } from "./form-sections/sub-agents-section";
import { SkillsSection } from "./form-sections/skills-section";
import { AI_NAME } from "@/constants/main";

interface AgentFormProps {
  initialData?: Agent | null;
  existingAgents: Agent[];
  onSave: (agentData: Partial<Agent>, pendingFiles?: File[]) => Promise<void>;
  isSaving: boolean;
  title: string;
}

const SECTIONS = [
  { id: "agent-basic-info", label: "Basic Info", icon: Info },
  { id: "agent-behavior", label: "Behavior", icon: Settings },
  { id: "agent-system-tools", label: "System Tools", icon: Zap },
  { id: "agent-custom-tools", label: "Custom Tools", icon: Wrench },
  { id: "agent-mcp-tools", label: "Connectors", icon: Layout },
  { id: "agent-sub-agents", label: "Sub Agents", icon: Users },
  { id: "agent-skills", label: "Skills", icon: Sparkles },
  { id: "agent-knowledge", label: "Knowledge", icon: BookOpen },
];

export function AgentForm({
  initialData,
  onSave,
  isSaving,
  title,
  existingAgents,
}: AgentFormProps) {
  const router = useRouter();
  const { data: customTools = [], isLoading: isLoadingCustomTools } =
    useTools();
  const {
    servers,
    tools: mcpTools,
    isLoading: isLoadingMCP,
    fetchServers,
    fetchTools,
  } = useMCPStore();

  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(
    initialData?.description || "",
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialData?.systemPrompt || "",
  );
  const [tools, setTools] = useState<string[]>(initialData?.tools || []);
  const [model, setModel] = useState<string>(
    initialData?.modelId || "gemini-3-flash-preview",
  );
  const [temperature, setTemperature] = useState<number>(
    initialData?.temperature ?? 0.7,
  );
  const [topP, setTopP] = useState<number>(initialData?.topP ?? 1);
  const [documents, setDocuments] = useState<AgentDocument[]>(
    initialData?.documents || [],
  );
  const [subAgents, setSubAgents] = useState<{ id: string; name: string }[]>(
    initialData?.subAgents || [],
  );
  const [skills, setSkills] = useState<AgentSkill[]>(initialData?.skills || []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [activeSection, setActiveSection] = useState("agent-basic-info");
  const [systemToolsSearch, setSystemToolsSearch] = useState("");
  const [customToolsSearch, setCustomToolsSearch] = useState("");
  const [mcpToolsSearch, setMcpToolsSearch] = useState("");

  // Agent Generator State
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [generatorQuery, setGeneratorQuery] = useState("");
  const [isGeneratingAgent, setIsGeneratingAgent] = useState(false);
  const [shouldGenerateTools, setShouldGenerateTools] = useState(true);
  const [shouldGenerateModel, setShouldGenerateModel] = useState(true);
  const [shouldGenerateSubAgents, setShouldGenerateSubAgents] = useState(true);
  const [shouldGenerateSkills, setShouldGenerateSkills] = useState(true);

  // System Prompt Tailoring State
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const [promptQuery, setPromptQuery] = useState("");
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  // Variable Insertion State
  const [isVariableDialogOpen, setIsVariableDialogOpen] = useState(false);

  const generatorToolOptions = useMemo<AgentToolOption[]>(() => {
    const defaultToolOptions: AgentToolOption[] = DEFAULT_TOOLS_METADATA.filter(
      (tool) => !tool.alwaysEnabled,
    ).map((tool) => ({
      id: `default:${tool.name}`,
      name: tool.name,
      description: tool.description,
      source: "default",
    }));

    const mcpToolOptions: AgentToolOption[] = servers.flatMap((server) =>
      (mcpTools[server.id] || []).map((tool) => ({
        id: `${server.name}:${tool.name}`,
        name: tool.name,
        description: tool.description || "Connector tool",
        source: "mcp" as const,
      })),
    );

    const deduped = new Map<string, AgentToolOption>();
    [...defaultToolOptions, ...mcpToolOptions].forEach((tool) => {
      if (!deduped.has(tool.id)) {
        deduped.set(tool.id, tool);
      }
    });

    return Array.from(deduped.values());
  }, [servers, mcpTools]);

  const generatorModelOptions = useMemo<AgentModelOption[]>(() => {
    return AVAILABLE_MODELS.filter((available) => available.supportsTools).map(
      (available) => ({
        id: available.id,
        name: available.name,
        provider: available.provider,
        description: available.description,
      }),
    );
  }, []);

  const generatorSubAgentOptions = useMemo<AgentSubAgentOption[]>(() => {
    return existingAgents
      .filter((agent) => agent.active && agent.id !== initialData?.id)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
      }));
  }, [existingAgents, initialData?.id]);

  const handleInsertVariable = (variable: string) => {
    setSystemPrompt((prev: string) => prev + (prev ? " " : "") + variable);
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadData = async () => {
      await fetchServers();
    };
    loadData();
  }, [fetchServers]);

  useEffect(() => {
    if (servers.length > 0) {
      servers.forEach((server) => {
        if (!mcpTools[server.id]) {
          fetchTools(server.id);
        }
      });
    }
  }, [servers, fetchTools, mcpTools]);

  // Sync form state when initialData changes (e.g., after fetch completes or cache updates)
  useEffect(() => {
    if (initialData) {
      setName(initialData.name || "");
      setDescription(initialData.description || "");
      setSystemPrompt(initialData.systemPrompt || "");
      setTools(initialData.tools || []);
      setModel(initialData.modelId || "gemini-3-flash-preview");
      setTemperature(initialData.temperature ?? 0.7);
      setTopP(initialData.topP ?? 1);

      setDocuments(initialData.documents || []);
      setSubAgents(initialData.subAgents || []);
      setSkills(initialData.skills || []);
    }
  }, [initialData]);

  const handleSave = async () => {
    if (!name || !description) return;

    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === model);

    const agentData = {
      name,
      description,
      systemPrompt: systemPrompt || undefined,
      tools,
      modelId: model,
      temperature: selectedModel?.supportsTemperature ? temperature : undefined,
      topP: selectedModel?.supportsTopP ? topP : undefined,

      subAgents,
      skills,
      documents: documents.filter((d) => !d.id.startsWith("pending-")),
    };

    await onSave(agentData, pendingFiles);
  };

  const handleGenerateAgent = async () => {
    if (!generatorQuery) return;

    setIsGeneratingAgent(true);
    try {
      const result = await generateAgentAction(generatorQuery, {
        includeTools: shouldGenerateTools,
        toolOptions: shouldGenerateTools ? generatorToolOptions : [],
        includeModel: shouldGenerateModel,
        modelOptions: shouldGenerateModel ? generatorModelOptions : [],
        includeSubAgents: shouldGenerateSubAgents,
        subAgentOptions: shouldGenerateSubAgents
          ? generatorSubAgentOptions
          : [],
        includeSkills: shouldGenerateSkills,
      });
      if (result) {
        setName(result.name);
        setDescription(result.description);
        setSystemPrompt(result.systemPrompt);
        if (shouldGenerateTools && Array.isArray(result.tools)) {
          setTools(result.tools);
        }

        if (
          shouldGenerateModel &&
          result.modelId &&
          AVAILABLE_MODELS.some((available) => available.id === result.modelId)
        ) {
          setModel(result.modelId);
        }
        if (shouldGenerateSubAgents && Array.isArray(result.subAgents)) {
          setSubAgents(result.subAgents);
        }
        if (shouldGenerateSkills && Array.isArray(result.skills)) {
          setSkills(
            result.skills.map((s) => ({
              id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              ...s,
            })),
          );
        }

        setIsGeneratorOpen(false);
        setGeneratorQuery("");
      }
    } catch (error) {
      logger.error("Agent generation failed:", error);
    } finally {
      setIsGeneratingAgent(false);
    }
  };

  const handleGeneratePrompt = async () => {
    if (!promptQuery) return;

    setIsGeneratingPrompt(true);
    try {
      const response = await generateSystemPromptAction(
        promptQuery,
        systemPrompt,
      );

      setSystemPrompt(response);
      setIsPromptDialogOpen(false);
      setPromptQuery("");
    } catch (error) {
      logger.error("Failed to generate prompt:", error);
    } finally {
      setIsGeneratingPrompt(false);
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

  // Auto-update active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (!scrollContainerRef.current) return;
      const containerRect = scrollContainerRef.current.getBoundingClientRect();
      const threshold = containerRect.top + 150;

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

  // Track which sections the user has visited/scrolled past
  const activeSectionIndex = SECTIONS.findIndex((s) => s.id === activeSection);

  if (initialData && !initialData.active) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-8">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Agent Disabled
        </h2>
        <p className="text-text-secondary mb-4 max-w-md">
          This agent has been disabled. You cannot edit a disabled agent.
        </p>
        <Button onClick={() => router.back()} className="text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Go Back
        </Button>
      </div>
    );
  }

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
          {(!name || !description) && (
            <span className="text-[11px] text-foreground/40 font-medium mr-2 hidden sm:block">
              Name and purpose required
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={!name || !description || isSaving}
            className="h-9 px-5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg shadow-sm active:scale-[0.98] transition-all disabled:opacity-40 disabled:scale-100"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {isSaving
              ? "Saving..."
              : initialData
                ? "Update Agent"
                : "Create Agent"}
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
              <Bot className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                Tip
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-foreground/50">
              Each section configures a different aspect of your agent&apos;s
              capabilities.
            </p>
          </div>
        </aside>

        {/* Main Form Area */}
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
            <BasicInfoSection
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
            />

            <BehaviorSection
              systemPrompt={systemPrompt}
              setSystemPrompt={setSystemPrompt}
              model={model}
              setModel={setModel}
              temperature={temperature}
              setTemperature={setTemperature}
              topP={topP}
              setTopP={setTopP}
              onOpenPromptDialog={() => setIsPromptDialogOpen(true)}
              onOpenVariableDialog={() => setIsVariableDialogOpen(true)}
            />

            <SystemToolsSection
              tools={tools}
              setTools={setTools}
              search={systemToolsSearch}
              setSearch={setSystemToolsSearch}
            />

            <CustomToolsSection
              tools={tools}
              setTools={setTools}
              search={customToolsSearch}
              setSearch={setCustomToolsSearch}
              customTools={customTools}
              isLoading={isLoadingCustomTools}
            />

            <McpToolsSection
              tools={tools}
              setTools={setTools}
              search={mcpToolsSearch}
              setSearch={setMcpToolsSearch}
              servers={servers}
              mcpTools={mcpTools}
              isLoading={isLoadingMCP}
            />

            <SubAgentsSection
              subAgents={subAgents}
              setSubAgents={setSubAgents}
              existingAgents={existingAgents}
              currentAgentId={initialData?.id}
            />

            <SkillsSection skills={skills} setSkills={setSkills} />

            {/* Knowledge */}
            <section id="agent-knowledge" className="space-y-5 scroll-mt-6">
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
                  <BookOpen className="h-4.5 w-4.5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">
                    Knowledge
                  </h2>
                  <p className="text-[13px] text-foreground/50 leading-relaxed">
                    Upload documents for the agent to reference when responding.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-input-border p-4 md:p-5 hover:border-primary/20 transition-colors bg-card-bg/50">
                <DocumentUploadSection
                  agentId={initialData?.id}
                  documents={documents}
                  onDocumentsChange={setDocuments}
                  onPendingFilesChange={setPendingFiles}
                  isNewAgent={!initialData}
                />
              </div>
            </section>

            {/* Schedules (edit mode only) */}
            {initialData?.id && (
              <div className="mt-8 border-t border-card-border pt-6">
                <TargetSchedules targetType="agent" targetId={initialData.id} />
              </div>
            )}
          </div>
        </main>
      </div>

      <AgentGeneratorDialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        query={generatorQuery}
        setQuery={setGeneratorQuery}
        includeTools={shouldGenerateTools}
        setIncludeTools={setShouldGenerateTools}
        availableToolCount={generatorToolOptions.length}
        includeModel={shouldGenerateModel}
        setIncludeModel={setShouldGenerateModel}
        availableModelCount={generatorModelOptions.length}
        includeSubAgents={shouldGenerateSubAgents}
        setIncludeSubAgents={setShouldGenerateSubAgents}
        availableSubAgentCount={generatorSubAgentOptions.length}
        includeSkills={shouldGenerateSkills}
        setIncludeSkills={setShouldGenerateSkills}
        isGenerating={isGeneratingAgent}
        onGenerate={handleGenerateAgent}
      />

      <PromptDialog
        open={isPromptDialogOpen}
        onOpenChange={setIsPromptDialogOpen}
        query={promptQuery}
        setQuery={setPromptQuery}
        isGenerating={isGeneratingPrompt}
        onGenerate={handleGeneratePrompt}
      />

      <VariableDialog
        open={isVariableDialogOpen}
        onOpenChange={setIsVariableDialogOpen}
        onInsert={handleInsertVariable}
      />
    </div>
  );
}
