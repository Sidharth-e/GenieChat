"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { Agent, WorkflowOutputConfig, WorkflowStep, WorkflowTrigger } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NewAgenticWorkflowPage() {
    const router = useRouter();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const fetchAgents = async () => {
            try {
                // Fetch agents for the dropdown
                const response = await fetch(`/api/agents`);
                if (response.ok) {
                    const data = await response.json();
                    setAgents(data);
                }
            } catch (error) {
                logger.error("Failed to fetch agents:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAgents();
    }, []);

    const handleSave = async (data: {
        name: string;
        description: string;
        trigger?: WorkflowTrigger;
        output?: WorkflowOutputConfig;
        steps: Partial<WorkflowStep>[];
        outputPosition?: { x: number; y: number };
    }) => {
        setIsSubmitting(true);
        try {
            const response = await fetch(`/api/workflows`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                const newWorkflow = await response.json();
                router.push(`/workflow/${newWorkflow.id}/view/agentic-workflow`);
            } else {
                logger.error("Failed to create workflow");
            }
        } catch (error) {
            logger.error("Error creating workflow:", error);
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

    return (
        <div className="relative h-full w-full bg-background overflow-hidden z-[60]">
            {/* Floating Back Button */}
            <div className="absolute top-6 left-6 z-20">
                <Link href="/workflow">
                    <Button variant="outline" size="icon" className="h-[42px] w-[42px] rounded-xl bg-background/80 backdrop-blur-md border-tertiary/20 text-tertiary hover:text-foreground shadow-sm hover:scale-105 transition-all">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
            </div>

            {/* Editor Content */}
            <WorkflowEditor
                workflow={null}
                agents={agents}
                onSave={handleSave}
                isSubmitting={isSubmitting}
            />
        </div>
    );
}
