"use client";

import { useState, useRef, useCallback } from "react";
import {
  Plus,
  X,
  Sparkles,
  Pencil,
  ChevronRight,
  FileText,
  FolderOpen,
  Folder,
  Copy,
  GripVertical,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentSkill } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseSkillMarkdown(
  content: string,
  filename: string,
): Omit<AgentSkill, "id"> {
  const frontmatterMatch = content.match(
    /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/,
  );

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    return {
      name: nameMatch?.[1]?.trim() || filename,
      description: descMatch?.[1]?.trim() || "",
      instructions: body || content.trim(),
    };
  }

  return {
    name: filename,
    description: "",
    instructions: content.trim(),
  };
}

interface SkillsSectionProps {
  skills: AgentSkill[];
  setSkills: (skills: AgentSkill[]) => void;
}

export function SkillsSection({ skills, setSkills }: SkillsSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstructions("");
    setEditingSkill(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (skill: AgentSkill) => {
    setEditingSkill(skill);
    setName(skill.name);
    setDescription(skill.description);
    setInstructions(skill.instructions);
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!name.trim() || !instructions.trim()) return;

    if (editingSkill) {
      setSkills(
        skills.map((s) =>
          s.id === editingSkill.id
            ? {
                ...s,
                name: name.trim(),
                description: description.trim(),
                instructions: instructions.trim(),
              }
            : s,
        ),
      );
    } else {
      const newSkill: AgentSkill = {
        id: `skill_${Date.now()}`,
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
      };
      setSkills([...skills, newSkill]);
    }

    setIsDialogOpen(false);
    resetForm();
  };

  const handleDuplicate = (skill: AgentSkill) => {
    const duplicate: AgentSkill = {
      id: `skill_${Date.now()}`,
      name: `${skill.name} (copy)`,
      description: skill.description,
      instructions: skill.instructions,
    };
    setSkills([...skills, duplicate]);
  };

  const handleRemove = (id: string) => {
    setSkills(skills.filter((s) => s.id !== id));
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const instructionLineCount = (text: string) =>
    text.split("\n").filter((l) => l.trim()).length;

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const mdFiles = Array.from(files).filter(
        (f) => f.name.endsWith(".md") || f.name.endsWith(".markdown"),
      );
      if (mdFiles.length === 0) return;

      Promise.all(
        mdFiles.map(
          (file) =>
            new Promise<AgentSkill>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const content = reader.result as string;
                const baseName = file.name.replace(/\.(md|markdown)$/, "");
                const parsed = parseSkillMarkdown(content, baseName);
                resolve({
                  id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  ...parsed,
                });
              };
              reader.readAsText(file);
            }),
        ),
      ).then((newSkills) => {
        setSkills([...skills, ...newSkills]);
      });
    },
    [skills, setSkills],
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  return (
    <section id="agent-skills" className="space-y-5 scroll-mt-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
          <Sparkles className="h-4.5 w-4.5" />
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Skills
            </h2>
            {skills.length > 0 && (
              <span className="text-[11px] font-medium text-foreground/35 tabular-nums">
                {skills.length} skill{skills.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-[13px] text-foreground/50 leading-relaxed">
            Add reusable behavioral skills. Each skill&apos;s instructions are
            injected into the agent&apos;s system prompt at runtime.
          </p>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Folder container */}
      <div
        className={cn(
          "rounded-xl border bg-card-bg/30 overflow-hidden transition-colors",
          isDragOver
            ? "border-primary border-dashed bg-primary/5"
            : "border-input-border",
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Folder header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-surface-muted/50 border-b border-input-border">
          <div className="flex items-center gap-2 text-foreground/50">
            {skills.length > 0 ? (
              <FolderOpen className="h-3.5 w-3.5" />
            ) : (
              <Folder className="h-3.5 w-3.5" />
            )}
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">
              Skills Directory
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2.5 text-xs font-medium text-foreground/50 hover:bg-hover-bg hover:text-foreground gap-1.5"
            >
              <Upload className="h-3 w-3" />
              Import .md
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenAdd}
              className="h-7 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary gap-1.5"
            >
              <Plus className="h-3 w-3" />
              New
            </Button>
          </div>
        </div>

        {isDragOver ? (
          /* Drag overlay */
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
            <div className="h-12 w-12 rounded-xl bg-primary/10 border-2 border-dashed border-primary/40 flex items-center justify-center mb-3 animate-pulse">
              <Upload className="h-5 w-5 text-primary/60" />
            </div>
            <p className="text-sm font-medium text-primary/70">
              Drop .md files to import skills
            </p>
            <p className="text-[12px] text-primary/40 mt-1">
              Supports frontmatter: name, description
            </p>
          </div>
        ) : skills.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="h-12 w-12 rounded-xl bg-primary/5 border border-dashed border-primary/20 flex items-center justify-center mb-3">
              <FileText className="h-5 w-5 text-primary/40" />
            </div>
            <p className="text-sm font-medium text-foreground/40">
              No skills defined
            </p>
            <p className="text-[12px] text-foreground/30 mt-2 max-w-[280px]">
              Create a skill manually or drag &amp; drop{" "}
              <code className="text-[11px] bg-hover-bg px-1 py-0.5 rounded">.md</code>{" "}
              files with frontmatter
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenAdd}
                className="h-8 px-3 text-xs font-medium gap-1.5"
              >
                <Plus className="h-3 w-3" />
                Create
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 px-3 text-xs font-medium gap-1.5"
              >
                <Upload className="h-3 w-3" />
                Import .md
              </Button>
            </div>
          </div>
        ) : (
          /* Skill file list */
          <div className="divide-y divide-input-border/60">
            {skills.map((skill) => {
              const isExpanded = expandedSkills.has(skill.id);
              const lines = instructionLineCount(skill.instructions);

              return (
                <div
                  key={skill.id}
                  className={cn(
                    "group transition-colors",
                    isExpanded ? "bg-primary/[0.02]" : "hover:bg-hover-bg/50",
                  )}
                >
                  {/* Skill row */}
                  <div className="flex items-center gap-0 px-1.5">
                    {/* Drag handle area */}
                    <div className="flex items-center justify-center w-6 shrink-0 opacity-0 group-hover:opacity-40 transition-opacity cursor-grab">
                      <GripVertical className="h-3.5 w-3.5 text-foreground/40" />
                    </div>

                    {/* Expand toggle + file info */}
                    <button
                      onClick={() => toggleExpand(skill.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 py-3 pr-2 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 text-foreground/30 shrink-0 transition-transform duration-200",
                          isExpanded && "rotate-90 text-primary/60",
                        )}
                      />
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={cn(
                            "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                            isExpanded
                              ? "bg-primary/12 text-primary"
                              : "bg-primary/6 text-primary/60",
                          )}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "font-medium text-sm truncate transition-colors",
                                isExpanded
                                  ? "text-foreground"
                                  : "text-foreground/80",
                              )}
                            >
                              {skill.name}
                            </span>
                            <span className="text-[10px] font-mono text-foreground/25 shrink-0">
                              {lines} line{lines !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {skill.description && (
                            <span className="text-[12px] text-foreground/40 block truncate mt-0.5">
                              {skill.description}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(skill)}
                        className="h-7 w-7 hover:text-primary hover:bg-primary/10 rounded-md"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDuplicate(skill)}
                        className="h-7 w-7 hover:text-primary hover:bg-primary/10 rounded-md"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(skill.id)}
                        className="h-7 w-7 hover:text-red-500 hover:bg-red-500/10 rounded-md"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Expanded content — instruction preview */}
                  {isExpanded && (
                    <div className="px-12 pb-4">
                      <div className="rounded-lg border border-input-border/60 bg-background overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-muted/40 border-b border-input-border/40">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/35">
                            Instructions
                          </span>
                          <button
                            onClick={() => handleOpenEdit(skill)}
                            className="text-[10px] font-medium text-primary/60 hover:text-primary transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                        <pre className="px-3 py-2.5 text-[12px] leading-relaxed text-foreground/60 font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                          {skill.instructions}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom add bar — only when skills exist */}
        {skills.length > 0 && (
          <button
            onClick={handleOpenAdd}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-t border-input-border/60 text-[12px] font-medium text-foreground/30 hover:text-primary hover:bg-primary/5 transition-all"
          >
            <Plus className="h-3 w-3" />
            Add skill
          </button>
        )}
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) resetForm();
          setIsDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSkill ? "Edit Skill" : "New Skill"}
            </DialogTitle>
            <DialogDescription>
              {editingSkill
                ? "Update this skill\u0027s name, description, and instructions."
                : "Define a new skill with instructions that will be added to the agent\u0027s system prompt."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45 ml-0.5">
                Skill Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Code Review, Data Analysis"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45 ml-0.5">
                Description (optional)
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this skill does"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45 ml-0.5">
                Instructions
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="System prompt instructions for this skill..."
                className="w-full rounded-lg border border-input-border bg-input-bg px-3.5 py-2.5 text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-foreground placeholder:text-foreground/25 min-h-[120px] resize-y font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || !instructions.trim()}
            >
              {editingSkill ? "Update Skill" : "Create Skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
