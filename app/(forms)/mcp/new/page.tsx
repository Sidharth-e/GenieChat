"use client";

import { logger } from "@/lib/logger";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateMCPServer, type MCPServerInput } from "@/hooks/use-mcp-queries";
import { MCPForm } from "@/components/mcp/mcp-form";

export default function NewMCPPage() {
    const router = useRouter();
    const { mutateAsync: createServer } = useCreateMCPServer();
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async (serverData: MCPServerInput) => {
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
