"use client";

import { logger } from "@/lib/logger";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateConnector, type ConnectorInput } from "@/hooks/use-connector-queries";
import { ConnectorForm } from "@/components/connectors/connector-form";

export default function NewConnectorPage() {
    const router = useRouter();
    const { mutateAsync: createServer } = useCreateConnector();
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async (serverData: ConnectorInput) => {
        setIsSaving(true);
        try {
            await createServer(serverData);
            router.push("/connectors");
        } catch (error) {
            logger.error("Failed to add connector:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <ConnectorForm
            title="Add New Connector"
            onSave={handleSave}
            isSaving={isSaving}
        />
    );
}
