"use client";

import { logger } from "@/lib/logger";
import { useRouter } from "next/navigation";
import { useCreatePrompt } from "@/hooks/use-prompts-queries";
import { PromptForm } from "@/components/prompts/prompt-form";
import { Prompt } from "@/lib/types";

export default function NewPromptPage() {
    const router = useRouter();
    const createPromptMutation = useCreatePrompt();

    const handleSave = async (promptData: Partial<Prompt>) => {
        try {
            const { title, content, tags, isShared } = promptData;
            if (!title || !content) return;
            await createPromptMutation.mutateAsync({ title, content, tags, isShared });
            router.push("/prompts");
        } catch (error) {
            logger.error("Failed to create prompt:", error);
        }
    };

    return (
        <PromptForm
            title="Create New Prompt"
            onSave={handleSave}
            isSaving={createPromptMutation.isPending}
        />
    );
}
