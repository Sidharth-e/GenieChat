"use client";

import { logger } from "@/lib/logger";
import { useRouter, useParams } from "next/navigation";
import { useAgent, useAgents, useUpdateAgent } from "@/hooks/use-agents-queries";
import { AgentForm } from "@/components/agents/agent-form";
import { Agent } from "@/lib/types";
import { Bot, Loader2 } from "lucide-react";

export default function EditAgentPage() {
    const router = useRouter();
    const params = useParams();
    const agentId = params.id as string;

    // Server state from React Query
    const { data: agent, isLoading } = useAgent(agentId);
    const { data: agents = [] } = useAgents();
    const updateAgentMutation = useUpdateAgent();

    const handleSave = async (agentData: Partial<Agent>) => {
        try {
            await updateAgentMutation.mutateAsync({ id: agentId, updates: agentData });
            router.push("/agents");
        } catch (error) {
            logger.error("Failed to update agent:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!agent) {
        return (
            <div className="flex h-screen flex-col items-center justify-center p-6 text-center">
                <Bot className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium text-foreground">
                    Agent Not Found
                </h3>
                <p className="text-sm text-muted-foreground">
                    The agent you are trying to edit does not exist.
                </p>
                <button
                    onClick={() => router.push("/agents")}
                    className="mt-4 text-sm font-medium text-primary hover:underline"
                >
                    Back to Agents
                </button>
            </div>
        );
    }

    return (
        <AgentForm
            title={`Edit ${agent.name}`}
            initialData={agent}
            existingAgents={agents}
            onSave={handleSave}
            isSaving={updateAgentMutation.isPending}
        />
    );
}
