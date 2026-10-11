"use client";

import { logger } from "@/lib/logger";
import { useRouter } from "next/navigation";
import { useCreateTool } from "@/hooks/use-tools-queries";
import { ToolForm } from "@/components/tools/tool-form";
import type { CustomTool } from "@/lib/types";

export default function NewToolPage() {
    const router = useRouter();
    const createToolMutation = useCreateTool();

    const handleSave = async (toolData: Partial<CustomTool>) => {
        try {
            await createToolMutation.mutateAsync(
                toolData as Parameters<typeof createToolMutation.mutateAsync>[0]
            );
            router.push("/tools");
        } catch (error) {
            logger.error("Failed to create tool:", error);
        }
    };

    return (
        <ToolForm
            title="Create New Custom Tool"
            onSave={handleSave}
            isSaving={createToolMutation.isPending}
        />
    );
}
