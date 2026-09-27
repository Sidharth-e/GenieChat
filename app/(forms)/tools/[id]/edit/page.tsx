"use client";

import { logger } from "@/lib/logger";
import { useRouter, useParams } from "next/navigation";
import { useTool, useUpdateTool } from "@/hooks/use-tools-queries";
import { ToolForm } from "@/components/tools/tool-form";
import type { CustomTool } from "@/lib/types";
import { Wrench, Loader2 } from "lucide-react";

export default function EditToolPage() {
    const router = useRouter();
    const params = useParams();
    const toolId = params.id as string;

    // Server state from React Query
    const { data: tool, isLoading } = useTool(toolId);
    const updateToolMutation = useUpdateTool();

    const handleSave = async (toolData: Partial<CustomTool>) => {
        try {
            await updateToolMutation.mutateAsync({ id: toolId, updates: toolData });
            router.push("/tools");
        } catch (error) {
            logger.error("Failed to update tool:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!tool) {
        return (
            <div className="flex h-screen flex-col items-center justify-center p-6 text-center">
                <Wrench className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium text-foreground">
                    Tool Not Found
                </h3>
                <p className="text-sm text-muted-foreground">
                    The custom tool you are trying to edit does not exist.
                </p>
                <button
                    onClick={() => router.push("/tools")}
                    className="mt-4 text-sm font-medium text-primary hover:underline"
                >
                    Back to Tools
                </button>
            </div>
        );
    }

    return (
        <ToolForm
            title={`Edit ${tool.name}`}
            initialData={tool}
            onSave={handleSave}
            isSaving={updateToolMutation.isPending}
        />
    );
}
