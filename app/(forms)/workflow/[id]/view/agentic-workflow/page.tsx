"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, useMemo, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { Agent, Workflow } from "@/lib/types";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { useWorkflowRun } from "@/hooks/use-workflow-run";
import { WorkflowResultPanel } from "@/components/workflow/workflow-result-panel";
import { ArrowLeft, Loader2, Play, Pen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function ViewAgenticWorkflowPage({ params }: PageProps) {
    const { id } = use(params);
    const router = useRouter();
    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [agentsRes, workflowRes] = await Promise.all([
                    fetch(`/api/agents`),
                    fetch(`/api/workflows/${id}`),
                ]);

                if (agentsRes.ok) {
                    setAgents(await agentsRes.json());
                }

                if (workflowRes.ok) {
                    setWorkflow(await workflowRes.json() as Workflow);
                } else {
                    router.push("/workflow");
                }
            } catch (error) {
                logger.error("Failed to fetch data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [id, router]);

    const {
        isExecuting,
        isComplete,
        stepStatuses,
        finalResult,
        startRun,
        resetRun,
    } = useWorkflowRun(workflow);

    const [resultPanelOpen, setResultPanelOpen] = useState(false);

    const outputType = workflow?.output?.type || "markdown";

    const completedSteps = stepStatuses.filter(s => s.status === "completed").length;
    const failedSteps = stepStatuses.filter(s => s.status === "error").length;
    const totalDuration = stepStatuses.reduce((sum, s) => sum + (s.duration || 0), 0);

    const hasAutoRunRef = useRef(false);

    useEffect(() => {
        if (!workflow || hasAutoRunRef.current) return;
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("autoRun") === "true") {
            hasAutoRunRef.current = true;
            startRun();
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, [workflow, startRun]);

    useEffect(() => {
        if (isComplete && finalResult) {
            const timer = setTimeout(() => {
                setResultPanelOpen(true);
            }, 0);
            return () => clearTimeout(timer);
        }
    }, [isComplete, finalResult]);

    const workflowWithStatuses = useMemo<Workflow | null>(() => {
        if (!workflow) return null;
        return {
            ...workflow,
            steps: workflow.steps.map((step, index) => ({
                ...step,
                status: stepStatuses[index]?.status,
            })),
        };
    }, [workflow, stepStatuses]);

    if (isLoading || !workflow || !workflowWithStatuses) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-tertiary/50" />
            </div>
        );
    }

    return (
        <div className="relative h-full w-full bg-background overflow-hidden">
            <WorkflowEditor
                workflow={workflowWithStatuses}
                agents={agents}
                readonly={true}
            />

            <div className="absolute top-6 left-6 z-20">
                <Link href="/workflow">
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-[42px] w-[42px] rounded-xl bg-background/80 backdrop-blur-md border-tertiary/20 text-tertiary hover:text-foreground shadow-sm hover:scale-105 transition-all"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
            </div>

            <div className="absolute top-6 left-[72px] z-20 pointer-events-none">
                <h1 className="text-lg font-semibold text-foreground bg-background/80 backdrop-blur-md px-4 py-2 rounded-xl border border-tertiary/20 shadow-sm">
                    {workflow.name}
                </h1>
            </div>

            <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
                {!isExecuting && !isComplete && (
                    <Button
                        onClick={() => startRun()}
                        className="gap-1.5 rounded-xl shadow-lg"
                    >
                        <Play className="h-4 w-4" />
                        Run
                    </Button>
                )}
                {isExecuting && (
                    <Button disabled className="gap-1.5 rounded-xl shadow-lg">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Running...
                    </Button>
                )}
                {isComplete && (
                    <Button
                        variant="outline"
                        onClick={resetRun}
                        className="gap-1.5 rounded-xl bg-background/80 backdrop-blur-md border-tertiary/20 text-tertiary hover:text-foreground shadow-sm"
                    >
                        <RotateCcw className="h-4 w-4" />
                        Run Again
                    </Button>
                )}
                <Link href={`/workflow/${workflow.id}/edit/agentic-workflow`}>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-xl bg-background/80 backdrop-blur-md border-tertiary/20 text-tertiary hover:text-foreground shadow-sm"
                    >
                        <Pen className="h-3.5 w-3.5" />
                        Edit
                    </Button>
                </Link>
            </div>

            <WorkflowResultPanel
                open={resultPanelOpen}
                onOpenChange={setResultPanelOpen}
                finalResult={finalResult}
                outputType={outputType}
                stepsSummary={{
                    total: workflow.steps.length,
                    completed: completedSteps,
                    failed: failedSteps,
                    duration: totalDuration > 0 ? totalDuration : undefined,
                }}
            />
        </div>
    );
}
