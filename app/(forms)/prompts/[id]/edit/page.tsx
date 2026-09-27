"use client";

import { logger } from "@/lib/logger";
import { useRouter, useParams } from "next/navigation";
import { usePrompt, useUpdatePrompt } from "@/hooks/use-prompts-queries";
import { PromptForm } from "@/components/prompts/prompt-form";
import { Prompt } from "@/lib/types";
import { FileText, Loader2 } from "lucide-react";

export default function EditPromptPage() {
    const router = useRouter();
    const params = useParams();
    const promptId = params.id as string;

    // Server state from React Query
    const { data: prompt, isLoading } = usePrompt(promptId);
    const updatePromptMutation = useUpdatePrompt();

    const handleSave = async (promptData: Partial<Prompt>) => {
        try {
            await updatePromptMutation.mutateAsync({ id: promptId, updates: promptData });
            router.push("/prompts");
        } catch (error) {
            logger.error("Failed to update prompt:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!prompt) {
        return (
            <div className="flex h-screen flex-col items-center justify-center p-6 text-center">
                <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium text-foreground">
                    Prompt Not Found
                </h3>
                <p className="text-sm text-muted-foreground">
                    The prompt you are trying to edit does not exist.
                </p>
                <button
                    onClick={() => router.push("/prompts")}
                    className="mt-4 text-sm font-medium text-primary hover:underline"
                >
                    Back to Prompts
                </button>
            </div>
        );
    }

    return (
        <PromptForm
            title={`Edit ${prompt.title}`}
            initialData={prompt}
            onSave={handleSave}
            isSaving={updatePromptMutation.isPending}
        />
    );
}
