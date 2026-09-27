
import { Power, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CustomTool } from "@/lib/types";

interface ToolDetailDialogProps {
    isOpen: boolean;
    onClose: () => void;
    tool: CustomTool | null;
    onToggle: (tool: CustomTool) => void;
}

export function ToolDetailDialog({
    isOpen,
    onClose,
    tool,
    onToggle
}: ToolDetailDialogProps) {
    if (!tool) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-2">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "rounded-lg p-2 flex items-center justify-center",
                            tool.enabled
                                ? "bg-primary/10 text-primary"
                                : "bg-hover-bg text-text-secondary"
                        )}>
                            <Code className="h-5 w-5" />
                        </div>
                        <div>
                            <DialogTitle>{tool.name}</DialogTitle>
                            <DialogDescription className="mt-1">
                                {tool.description || "No description provided"}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
                    <div className="space-y-6">
                        {/* Status & Controls */}
                        <div className="flex items-center justify-between rounded-lg bg-secondary p-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium text-text-secondary">Status</div>
                                <div className={cn(
                                    "inline-flex items-center gap-2 text-sm font-semibold",
                                    tool.enabled ? "text-primary" : "text-text-secondary"
                                )}>
                                    <div className={cn("h-2 w-2 rounded-full", tool.enabled ? "bg-primary" : "bg-text-secondary")} />
                                    {tool.enabled ? "Active" : "Disabled"}
                                </div>
                            </div>
                            <Button
                                variant={tool.enabled ? "outline" : "default"}
                                size="sm"
                                onClick={() => onToggle(tool)}
                            >
                                <Power className="mr-2 h-4 w-4" />
                                {tool.enabled ? "Disable" : "Enable"}
                            </Button>
                        </div>

                        {/* Code Section */}
                        <div>
                            <h3 className="text-sm font-medium text-text-secondary mb-3">
                                JavaScript Code
                            </h3>
                            <pre className="w-full overflow-x-auto rounded-lg bg-secondary p-4 text-sm font-mono text-foreground">
                                {tool.code}
                            </pre>
                        </div>

                        {/* Parameters Section */}
                        {tool.parameters && tool.parameters.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-text-secondary mb-3">
                                    Parameters ({tool.parameters.length})
                                </h3>
                                <div className="space-y-2">
                                    {tool.parameters.map((param, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center justify-between rounded-lg border border-card-border bg-card-bg p-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <code className="font-mono text-sm font-semibold text-foreground">
                                                    {param.name}
                                                </code>
                                                <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
                                                    {param.type}
                                                </span>
                                                {param.required && (
                                                    <span className="text-xs text-red-500">Required</span>
                                                )}
                                            </div>
                                            {param.description && (
                                                <span className="text-sm text-text-secondary">
                                                    {param.description}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
