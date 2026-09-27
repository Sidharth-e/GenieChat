"use client";

import { Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface AgentGeneratorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    query: string;
    setQuery: (value: string) => void;
    includeTools: boolean;
    setIncludeTools: (value: boolean) => void;
    availableToolCount: number;
    includeModel: boolean;
    setIncludeModel: (value: boolean) => void;
    availableModelCount: number;
    includeSubAgents: boolean;
    setIncludeSubAgents: (value: boolean) => void;
    availableSubAgentCount: number;
    includeSkills: boolean;
    setIncludeSkills: (value: boolean) => void;
    isGenerating: boolean;
    onGenerate: () => void;
}

export function AgentGeneratorDialog({
    open,
    onOpenChange,
    query,
    setQuery,
    includeTools,
    setIncludeTools,
    availableToolCount,
    includeModel,
    setIncludeModel,
    availableModelCount,
    includeSubAgents,
    setIncludeSubAgents,
    availableSubAgentCount,
    includeSkills,
    setIncludeSkills,
    isGenerating,
    onGenerate,
}: AgentGeneratorDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Generate Agent</DialogTitle>
                    <DialogDescription>
                        Describe the agent you want. The AI will generate the name, purpose, and system instructions.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="e.g. 'A product support agent for SaaS onboarding' or 'A concise code review assistant that focuses on bugs and test gaps'"
                        className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/5 outline-none transition-all text-foreground min-h-[120px] resize-none"
                    />
                    <label className="flex items-start gap-3 rounded-xl border border-input-border bg-card-bg/40 px-3 py-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeTools}
                            onChange={(e) => setIncludeTools(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-input-border bg-input-bg text-primary focus:ring-primary/20"
                        />
                        <span className="text-sm text-foreground/80 leading-snug">
                            Let AI choose tools too
                            <span className="block text-xs text-foreground/45 mt-0.5">
                                Uses system + connector tools from your current workspace ({availableToolCount} available).
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-xl border border-input-border bg-card-bg/40 px-3 py-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeModel}
                            onChange={(e) => setIncludeModel(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-input-border bg-input-bg text-primary focus:ring-primary/20"
                        />
                        <span className="text-sm text-foreground/80 leading-snug">
                            Let AI choose model too
                            <span className="block text-xs text-foreground/45 mt-0.5">
                                Selects from your tool-capable models ({availableModelCount} available).
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-xl border border-input-border bg-card-bg/40 px-3 py-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeSubAgents}
                            onChange={(e) =>
                                setIncludeSubAgents(e.target.checked)
                            }
                            className="mt-0.5 h-4 w-4 rounded border-input-border bg-input-bg text-primary focus:ring-primary/20"
                        />
                        <span className="text-sm text-foreground/80 leading-snug">
                            Let AI choose sub-agents too
                            <span className="block text-xs text-foreground/45 mt-0.5">
                                Selects from active agents in your workspace ({availableSubAgentCount} available).
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-xl border border-input-border bg-card-bg/40 px-3 py-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeSkills}
                            onChange={(e) => setIncludeSkills(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-input-border bg-input-bg text-primary focus:ring-primary/20"
                        />
                        <span className="text-sm text-foreground/80 leading-snug">
                            Let AI generate skills too
                            <span className="block text-xs text-foreground/45 mt-0.5">
                                Creates reusable behavioral modules with instructions.
                            </span>
                        </span>
                    </label>
                </div>
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-foreground/60 hover:text-foreground"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={onGenerate}
                        disabled={!query || isGenerating}
                        className="bg-primary text-foreground hover:opacity-90"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Wand2 className="mr-2 h-4 w-4" />
                                Generate
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
