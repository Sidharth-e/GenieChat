"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, useRef } from "react";
import {
  FileText,
  Loader2,
  Info,
  Type,
  Tag,
  Wand2,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Prompt } from "@/lib/types";
import { useRouter } from "next/navigation";
import { generatePromptTemplateAction } from "@/lib/ai-actions/prompt-actions";
import { PromptDialog } from "@/components/agents/form-sections/prompt-dialog"; // Reusing the dialog
import { AI_NAME } from "@/constants/main";

interface PromptFormProps {
  initialData?: Prompt | null;
  onSave: (promptData: Partial<Prompt>) => Promise<void>;
  isSaving: boolean;
  title: string;
}

const SECTIONS = [
  { id: "prompt-basic-info", label: "Basic Info", icon: Info },
  { id: "prompt-content", label: "Prompt Content", icon: Type },
  { id: "prompt-tags", label: "Categories & Tags", icon: Tag },
];

export function PromptForm({
  initialData,
  onSave,
  isSaving,
  title,
}: PromptFormProps) {
  const router = useRouter();

  const [promptTitle, setPromptTitle] = useState(initialData?.title || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [tags, setTags] = useState((initialData?.tags || []).join(", ")); // Safe access

  // Generator State
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [generatorQuery, setGeneratorQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const [activeSection, setActiveSection] = useState("prompt-basic-info");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Update state when initialData changes (e.g. after fetch completes)
  useEffect(() => {
    if (initialData) {
      setPromptTitle(initialData.title || "");
      setContent(initialData.content || "");
      setTags((initialData.tags || []).join(", "));
    }
  }, [initialData]);

  const handleSave = async () => {
    if (!promptTitle || !content) return;

    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const promptData = {
      title: promptTitle,
      content,
      tags: tagList,
    };

    await onSave(promptData);
  };

  const handleGenerate = async () => {
    if (!generatorQuery) return;

    setIsGenerating(true);
    try {
      const result = await generatePromptTemplateAction(generatorQuery);
      if (result) {
        if (result.title && !promptTitle) {
          setPromptTitle(result.title);
        } else if (result.title && promptTitle) {
          // override the title if the user used magic generate
          setPromptTitle(result.title);
        }
        setContent(result.template);
        // Setup tags
        const existingTags = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const newTags = new Set([...existingTags, ...result.tags]);
        setTags(Array.from(newTags).join(", "));

        setIsGeneratorOpen(false);
        setGeneratorQuery("");
      }
    } catch (error) {
      logger.error("Prompt generation failed:", error);
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
            variant="outline"
            size="sm"
            onClick={() => setIsGeneratorOpen(true)}
            className="h-9 px-4 font-semibold text-primary border-primary/20 hover:bg-primary/10 transition-colors mr-2"
          >
            <Wand2 className="mr-2 h-4 w-4" />
            {AI_NAME} Assist
          </Button>
          {(!promptTitle || !content) && (
            <span className="text-[11px] text-foreground/40 font-medium mr-2 hidden sm:block">
              Title and content required
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={!promptTitle || !content || isSaving}
            className="h-9 px-5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg shadow-sm active:scale-[0.98] transition-all disabled:opacity-40 disabled:scale-100"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary-foreground" />
            ) : null}
            {isSaving
              ? "Saving..."
              : initialData
                ? "Update Prompt"
                : "Create Prompt"}
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
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                Tip
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-foreground/50">
              Craft powerful prompt templates to streamline your AI
              interactions.
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
            <section id="prompt-basic-info" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Basic Info
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Give your prompt a descriptive name.
                </p>
              </div>
              <div className="space-y-3">
                <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                  Prompt Title
                </label>
                <input
                  type="text"
                  value={promptTitle}
                  onChange={(e) => setPromptTitle(e.target.value)}
                  className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                  placeholder="e.g. Code Review Assistant"
                />
              </div>
            </section>

            {/* Prompt Content */}
            <section id="prompt-content" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Prompt Content
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Define the template for your prompt. Use {"{{variable}}"} for
                  placeholders.
                </p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-widest ml-1 text-primary">
                    Template
                  </label>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full rounded-3xl border border-input-border bg-input-bg px-6 py-5 text-[15px] font-mono focus:border-primary focus:ring-8 focus:ring-primary/5 outline-none transition-all text-foreground min-h-[300px] resize-none leading-[1.6]"
                  placeholder="Enter your prompt template here..."
                />
                {content.match(/\{\{(\w+)\}\}/g) && (
                  <div className="flex gap-2 flex-wrap pt-2 px-2">
                    {Array.from(new Set(content.match(/\{\{(\w+)\}\}/g)))
                      .map((v) => v.replace(/[{}]/g, ""))
                      .map((variable) => (
                        <span
                          key={variable}
                          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20"
                        >
                          {variable}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </section>

            {/* Categories & Tags */}
            <section id="prompt-tags" className="space-y-6 scroll-mt-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-foreground tracking-tight">
                  Categories & Tags
                </h2>
                <p className="text-sm font-medium text-foreground/50 leading-relaxed">
                  Add tags to categorize and find your prompts easily.
                </p>
              </div>
              <div className="space-y-3">
                <label className="text-[11px] font-black uppercase tracking-widest text-foreground/40 ml-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full rounded-2xl border border-input-border bg-input-bg px-5 py-4 text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all text-foreground"
                  placeholder="coding, documentation, research"
                />
              </div>
            </section>
          </div>
        </main>
      </div>
      <PromptDialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        query={generatorQuery}
        setQuery={setGeneratorQuery}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
