"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { Agent, Workflow, WorkflowOutputConfig, WorkflowStep, WorkflowTrigger } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function EditAgenticWorkflowPage({ params }: PageProps) {
    const { id } = use(params);
    const router = useRouter();
    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [agentsRes, workflowRes] = await Promise.all([
                    fetch(`/api/agents`),
                    fetch(`/api/workflows/${id}`)
                ]);

                if (agentsRes.ok) {
                    setAgents(await agentsRes.json());
                }

                if (workflowRes.ok) {
                    const data = await workflowRes.json();
                    setWorkflow(data as Workflow);
                } else {
                    router.push('/workflow');
                }
            } catch (error) {
                logger.error("Failed to fetch data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [id, router]);

    const handleSave = async (data: {
        name: string;
        description: string;
        trigger?: WorkflowTrigger;
        output?: WorkflowOutputConfig;
        steps: Partial<WorkflowStep>[];
        outputPosition?: { x: number; y: number };
    }) => {
        if (!workflow) return;
        setIsSubmitting(true);
        try {
            const response = await fetch(`/api/workflows/${workflow.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                router.push(`/workflow/${workflow.id}/view/agentic-workflow`);
                router.refresh();
            } else {
                logger.error("Failed to update workflow");
            }
        } catch (error) {
            logger.error("Error updating workflow:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-tertiary/50" />
            </div>
        );
    }

    if (!workflow) return null;

    return (
        <div className="relative h-full w-full bg-background overflow-hidden">
            <div className="absolute top-6 left-6 z-20">
                <Link href={`/workflow/${workflow.id}/view/agentic-workflow`}>
                    <Button variant="outline" size="icon" className="h-[42px] w-[42px] rounded-xl bg-background/80 backdrop-blur-md border-tertiary/20 text-tertiary hover:text-foreground shadow-sm hover:scale-105 transition-all">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
            </div>

            <WorkflowEditor
                workflow={workflow}
                agents={agents}
                onSave={handleSave}
                isSubmitting={isSubmitting}
            />
        </div>
    );
}
