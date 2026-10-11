"use client";

import { logger } from "@/lib/logger";
import { useRouter } from "next/navigation";
import { useAgents, useCreateAgent } from "@/hooks/use-agents-queries";
import { AgentForm } from "@/components/agents/agent-form";
import { Agent } from "@/lib/types";
import {
    createBackgroundUploadJob,
    markBackgroundUploadFileStatus,
} from "@/lib/agent-upload-status";

export default function NewAgentPage() {
    const router = useRouter();
    const { data: agents = [] } = useAgents();
    const createAgentMutation = useCreateAgent();

    const uploadPendingFilesInBackground = (
        agentId: string,
        files: File[],
        jobId: string,
    ) => {
        void Promise.allSettled(
            files.map(async (file, index) => {
                markBackgroundUploadFileStatus({
                    jobId,
                    file,
                    fileIndex: index,
                    status: "processing",
                });

                const formData = new FormData();
                formData.append("file", file);
                formData.append("agentId", agentId);

                try {
                    const response = await fetch("/api/agents/files", {
                        method: "POST",
                        body: formData,
                    });

                    if (!response.ok) {
                        const error = await response.json().catch(() => null);
                        throw new Error(error?.error || "Failed to upload file");
                    }

                    markBackgroundUploadFileStatus({
                        jobId,
                        file,
                        fileIndex: index,
                        status: "completed",
                    });
                } catch (e) {
                    logger.error("Failed to upload file:", file.name, e);
                    markBackgroundUploadFileStatus({
                        jobId,
                        file,
                        fileIndex: index,
                        status: "failed",
                        error: e instanceof Error ? e.message : "Upload failed",
                    });
                    throw e;
                }
            }),
        ).then((results) => {
            const failedCount = results.filter(
                (result) => result.status === "rejected",
            ).length;

            if (failedCount > 0) {
                logger.warn(
                    `[NewAgentPage] ${failedCount}/${files.length} pending file upload(s) failed for agent ${agentId}`,
                );
            }
        });
    };

    const handleSave = async (agentData: Partial<Agent>, pendingFiles?: File[]) => {
        try {
            const newAgent = await createAgentMutation.mutateAsync({
                name: agentData.name!,
                description: agentData.description!,
                systemPrompt: agentData.systemPrompt,
                tools: agentData.tools,
                modelId: agentData.modelId,
                temperature: agentData.temperature,
                topP: agentData.topP,
                subAgents: agentData.subAgents,
                skills: agentData.skills,
                documents: agentData.documents,
            });

            if (newAgent && pendingFiles && pendingFiles.length > 0) {
                const jobId = createBackgroundUploadJob({
                    agentId: newAgent.id,
                    agentName: newAgent.name || agentData.name || "Agent",
                    files: pendingFiles,
                });
                uploadPendingFilesInBackground(newAgent.id, pendingFiles, jobId);
            }

            router.push("/agents");
        } catch (error) {
            logger.error("Failed to create agent:", error);
        }
    };

    return (
        <AgentForm
            title="Create New Agent"
            existingAgents={agents}
            onSave={handleSave}
            isSaving={createAgentMutation.isPending}
        />
    );
}
