"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
    CheckCircle2,
    X,
    PanelRightClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer, messageContentStyles } from "@/components/common/markdown-renderer";
import { WorkflowOutputType } from "@/lib/types";
import { WorkflowOutputActions } from "./workflow-output-actions";

interface WorkflowResultPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    finalResult: string | null;
    outputType?: WorkflowOutputType;
    outputFileName?: string;
    stepsSummary?: {
        total: number;
        completed: number;
        failed: number;
        duration?: number;
    };
}

export function WorkflowResultPanel({
    open,
    onOpenChange,
    finalResult,
    outputType = "markdown",
    outputFileName,
    stepsSummary,
}: WorkflowResultPanelProps) {
    const [mounted, setMounted] = React.useState(false);

    const outputExtension = outputType === "json" ? "json" : outputType === "text" ? "txt" : "md";
    const fileName = outputFileName || `workflow-output.${outputExtension}`;

    React.useEffect(() => {
        setMounted(true);
    }, []);

    React.useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onOpenChange(false);
            }
        };

        if (open) {
            document.addEventListener("keydown", handleEscape);
            document.body.style.overflow = "hidden";
        }

        return () => {
            document.removeEventListener("keydown", handleEscape);
            document.body.style.overflow = "";
        };
    }, [open, onOpenChange]);

    if (!mounted) return null;

    return createPortal(
        <div
            className={cn(
                "fixed inset-0 z-100 transition-opacity duration-300",
                open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
        >
            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300",
                    open ? "opacity-100" : "opacity-0"
                )}
                onClick={() => onOpenChange(false)}
            />

            {/* Panel */}
            <div
                className={cn(
                    "fixed top-0 right-0 h-full w-full max-w-xl bg-secondary border-l border-tertiary/10 shadow-2xl",
                    "flex flex-col transition-transform duration-300 ease-out",
                    open ? "translate-x-0" : "translate-x-full"
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-tertiary/10">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-green-500 text-white shadow-lg shadow-green-500/20">
                            <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base text-tertiary">
                                Workflow Result
                            </h3>
                            {stepsSummary && (
                                <p className="text-xs text-tertiary/50">
                                    {stepsSummary.completed}/{stepsSummary.total} steps completed
                                    {stepsSummary.failed > 0 && (
                                        <span className="text-red-400 ml-1">
                                            ({stepsSummary.failed} failed)
                                        </span>
                                    )}
                                    {stepsSummary.duration != null && (
                                        <span className="ml-1">
                                            &middot; {stepsSummary.duration}s
                                        </span>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        className="h-8 w-8 p-0 text-tertiary/60 hover:text-tertiary"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Actions Bar */}
                {finalResult && (
                    <div className="flex items-center justify-between px-6 py-3 border-b border-tertiary/10 bg-secondary/80">
                        <p className="text-xs font-medium uppercase tracking-wider text-tertiary/40">
                            Final Output
                        </p>
                        <WorkflowOutputActions
                            content={finalResult}
                            fileName={fileName}
                            preferredFormat={outputType}
                        />
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {finalResult ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                            <MarkdownRenderer
                                content={finalResult}
                                className={messageContentStyles}
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-tertiary/40 gap-3">
                            <PanelRightClose className="h-10 w-10" />
                            <p className="text-sm">No result available</p>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
