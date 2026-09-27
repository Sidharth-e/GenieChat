"use client";

import { logger } from "@/lib/logger";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMCPStore } from "@/lib/stores";
import { MCPForm } from "@/components/mcp/mcp-form";

export default function NewMCPPage() {
    const router = useRouter();
    const { createServer } = useMCPStore();
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async (serverData: Parameters<typeof createServer>[0]) => {
        setIsSaving(true);
        try {
            await createServer(serverData);
            router.push("/mcp");
        } catch (error) {
            logger.error("Failed to add MCP server:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <MCPForm
            title="Add New Connector"
            onSave={handleSave}
            isSaving={isSaving}
        />
    );
}
