"use client";

import { logger } from "@/lib/logger";
import { useEffect, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Agent, RichWorkflow } from "@/lib/types";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function ViewNodeWorkflowPage({ params }: PageProps) {
    const { id } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const autoRun = searchParams.get("autoRun") === "true";
    const [richWorkflow, setRichWorkflow] = useState<RichWorkflow | null>(null);
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
                    setRichWorkflow(await workflowRes.json() as RichWorkflow);
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

    if (isLoading || !richWorkflow) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-tertiary/50" />
            </div>
        );
    }

    return (
        <div className="relative h-full w-full bg-background overflow-hidden">
            <WorkflowEditor
                workflow={null}
                agents={agents}
                richWorkflow={richWorkflow}
                readonly={false}
                autoRun={autoRun}
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
