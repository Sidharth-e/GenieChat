"use client";

import { Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";

interface PromptDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    query: string;
    setQuery: (value: string) => void;
    isGenerating: boolean;
    onGenerate: () => void;
    /** All three default to the agent-instructions copy. */
    title?: string;
    description?: string;
    placeholder?: string;
}

export function PromptDialog({
    open,
    onOpenChange,
    query,
    setQuery,
    isGenerating,
    onGenerate,
    title = "Tailor System Prompt",
    description = "Describe what you want the agent to do, or how you want to improve the current instructions.",
    placeholder = "e.g. 'Make the agent more concise', 'Create a prompt for a python coding expert', or 'Fix the tone to be more professional'",
}: PromptDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={placeholder}
                        className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/5 outline-none transition-all text-foreground min-h-[120px] resize-none"
                    />
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
