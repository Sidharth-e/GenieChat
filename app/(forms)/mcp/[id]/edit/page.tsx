"use client";

import { logger } from "@/lib/logger";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useMCPServers, useUpdateMCPServer } from "@/hooks/use-mcp-queries";
import { MCPForm, type MCPFormData } from "@/components/mcp/mcp-form";
import { Server, Loader2 } from "lucide-react";

export default function EditMCPPage() {
    const router = useRouter();
    const params = useParams();
    const serverId = params.id as string;

    const { data: servers = [], isLoading } = useMCPServers();
    const { mutateAsync: updateServer } = useUpdateMCPServer();
    const [isSaving, setIsSaving] = useState(false);

    const server = servers.find((s) => s.id === serverId);

    const handleSave = async (serverData: MCPFormData) => {
        setIsSaving(true);
        try {
            await updateServer({ id: serverId, updates: serverData });
            router.push("/mcp");
        } catch (error) {
            logger.error("Failed to update MCP server:", error);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading && !server) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!server) {
        return (
            <div className="flex h-screen flex-col items-center justify-center p-6 text-center">
                <Server className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium text-foreground">
                    Connector Not Found
                </h3>
                <p className="text-sm text-muted-foreground">
                    The connector you are trying to edit does not exist.
                </p>
                <button
                    onClick={() => router.push("/mcp")}
                    className="mt-4 text-sm font-medium text-primary hover:underline"
                >
                    Back to Connectors
                </button>
            </div>
        );
    }

    return (
        <MCPForm
            title={`Edit ${server.name}`}
            initialData={server}
            onSave={handleSave}
            isSaving={isSaving}
        />
    );
}
