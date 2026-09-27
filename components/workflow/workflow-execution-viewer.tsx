import { useState } from "react";
import {
    CheckCircle2,
    PanelRightOpen,
} from "lucide-react";
import { RichWorkflow, WorkflowOutputType, WorkflowStep } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { WorkflowEditor } from "./workflow-editor";
import { WorkflowResultPanel } from "./workflow-result-panel";

export interface ToolUsage {
    name: string;
    args: Record<string, unknown>;
    result?: string;
    status: 'running' | 'completed' | 'error';
}

export interface StepStatus {
    status: 'pending' | 'running' | 'completed' | 'error';
    result?: string;
    streamingContent?: string;
    duration?: number;
    tools: ToolUsage[];
    error?: string;
}

interface WorkflowExecutionViewerProps {
    steps: WorkflowStep[];
    stepStatuses: StepStatus[];
    isExecuting: boolean;
    isComplete: boolean;
    finalResult: string | null;
    outputType?: WorkflowOutputType;
    richWorkflow?: RichWorkflow;
}

export function WorkflowExecutionViewer({
    steps,
    stepStatuses,
    isComplete,
    finalResult,
    outputType = "markdown",
    richWorkflow,
}: WorkflowExecutionViewerProps) {
    const [resultPanelOpen, setResultPanelOpen] = useState(false);

    const completedSteps = stepStatuses.filter(s => s.status === "completed").length;
    const failedSteps = stepStatuses.filter(s => s.status === "error").length;
    const totalDuration = stepStatuses.reduce((sum, s) => sum + (s.duration || 0), 0);

    // Rich workflow mode — render WorkflowEditor with richWorkflow prop
    // The WorkflowCanvas handles its own inline execution via ExecuteTab
    if (richWorkflow) {
        return (
            <div className="flex flex-col gap-6">
                <div className="flex-1 w-full h-[600px] border border-tertiary/10 rounded-xl overflow-hidden relative">
                    <WorkflowEditor
                        workflow={null}
                        agents={[]}
                        readonly={false}
                        richWorkflow={richWorkflow}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Steps Execution Graph */}
            <div className="flex-1 w-full h-[600px] border border-tertiary/10 rounded-xl overflow-hidden relative">
                <WorkflowEditor
                    workflow={{
                        id: "execution-view",
                        userId: "system",
                        userName: "System",
                        userEmail: "system@local",
                        name: "Execution View",
                        description: "",
                        trigger: { type: "manual" },
                        steps: steps.map((step, index) => ({
                            ...step,
                            status: stepStatuses[index]?.status
                        })) as WorkflowStep[],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    }}
                    agents={[]}
                    readonly={true}
                />
            </div>

            {/* Completion Banner */}
            {isComplete && finalResult && (
                <div className="mt-4 p-5 rounded-xl border-2 border-green-500/30 bg-linear-to-br from-green-500/10 to-green-500/5 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-500 text-white shadow-lg shadow-green-500/20">
                                <CheckCircle2 className="h-5 w-5" />
                            </div>
                            <div>
                                <h4 className="font-bold text-tertiary">
                                    Execution Complete
                                </h4>
                                <p className="text-xs text-tertiary/50">
                                    {completedSteps}/{steps.length} steps completed
                                    {failedSteps > 0 && (
                                        <span className="text-red-400 ml-1">
                                            ({failedSteps} failed)
                                        </span>
                                    )}
                                    {totalDuration > 0 && (
                                        <span className="ml-1">&middot; {totalDuration}s</span>
                                    )}
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setResultPanelOpen(true)}
                            className="gap-2 text-sm text-tertiary hover:text-primary transition-colors hover:bg-tertiary/5"
                        >
                            <PanelRightOpen className="h-4 w-4" />
                            View Result
                        </Button>
                    </div>
                </div>
            )}

            {/* Result Side Panel */}
            <WorkflowResultPanel
                open={resultPanelOpen}
                onOpenChange={setResultPanelOpen}
                finalResult={finalResult}
                outputType={outputType}
                stepsSummary={{
                    total: steps.length,
                    completed: completedSteps,
                    failed: failedSteps,
                    duration: totalDuration > 0 ? totalDuration : undefined,
                }}
            />
        </div>
    );
}

