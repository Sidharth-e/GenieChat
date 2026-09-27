"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { Agent, RichWorkflow } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function EditNodeWorkflowPage({ params }: PageProps) {
    const { id } = use(params);
    const router = useRouter();
    const [richWorkflow, setRichWorkflow] = useState<RichWorkflow | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
                    setRichWorkflow(data as RichWorkflow);
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

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-tertiary/50" />
            </div>
        );
    }

    if (!richWorkflow) return null;

    return (
        <div className="relative h-full w-full bg-background overflow-hidden">
            <WorkflowEditor
                workflow={null}
                agents={agents}
                richWorkflow={richWorkflow}
                readonly={false}
            />
            <div className="absolute bottom-6 right-6 z-20">
                <Link href="/workflow">
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 rounded-xl bg-background/90 backdrop-blur-xl border-tertiary/20 text-tertiary hover:text-foreground shadow-lg"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
            </div>
        </div>
    );
}
