"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useConnectors,
  useConnectorTools,
  useDeleteConnector,
  useUpdateConnector,
} from "@/hooks/use-connector-queries";
import { useAgents } from "@/hooks/use-agents-queries";
import { ConnectorConfig } from "@/lib/types";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { ConnectorToolsDialog } from "@/components/connectors/connector-tools-dialog";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";

import { ContentLayout } from "@/components/common/content-layout";

interface ConnectorsContentProps {
  initialServers?: ConnectorConfig[];
}

export function ConnectorsContent({ initialServers = [] }: ConnectorsContentProps) {
  const {
    data: servers = [],
    isLoading,
    error,
  } = useConnectors(initialServers);
  const { mutateAsync: deleteServer } = useDeleteConnector();
  const { mutateAsync: updateServer } = useUpdateConnector();
  const { data: agents = [] } = useAgents();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [isToolsDialogOpen, setIsToolsDialogOpen] = React.useState(false);
  const [selectedServer, setSelectedServer] =
    React.useState<ConnectorConfig | null>(null);
  const [isDeleting, setIsDeleting] = React.useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<
    string | null
  >(null);
  const router = useRouter();

  // Tools are discovered for every enabled connector — the count on each card
  // is what tells the reader whether the connector is working.
  const enabledServerIds = React.useMemo(
    () =>
      servers.filter((server) => server.enabled).map((server) => server.id),
    [servers],
  );
  const { tools, isLoadingServerTools, toolsError, refreshTools } =
    useConnectorTools(enabledServerIds);

  const handleEdit = (server: ConnectorConfig) => {
    router.push(`/connectors/${server.id}/edit`);
  };

  const handleCreateNew = () => {
    router.push("/connectors/new");
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(id);
    await deleteServer(id);
    setIsDeleting(null);
    setShowDeleteConfirm(null);
  };

  const handleToggle = async (
    server: ConnectorConfig,
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    await updateServer({ id: server.id, updates: { enabled: !server.enabled } });
  };

  const handleViewTools = (server: ConnectorConfig) => {
    setSelectedServer(server);
    setIsToolsDialogOpen(true);
  };

  const filteredServers = servers.filter((server) => {
    const query = searchQuery.toLowerCase();
    return server.name.toLowerCase().includes(query);
  });

  const isServerUsedInAgent = (server: ConnectorConfig) => {
    return agents.some((agent) =>
      agent.tools?.some((t) => t.startsWith(`${server.name}:`)),
    );
  };

  return (
    <ContentLayout
      title="Connectors"
      description="Manage external connectors and tools for your agents."
      searchPlaceholder="Search connectors..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      actionButton={
        <Button
          onClick={handleCreateNew}
          className="h-10 rounded-full px-4 shadow-none hover:scale-100"
        >
          <Plus className="h-4 w-4" /> Add Connector
        </Button>
      }
    >
      {isLoading && servers.length === 0 ? (
        <div className="border border-card-border rounded-sm p-4 bg-card-bg animate-pulse">
          <div className="mb-2 h-4 w-2/3 rounded bg-hover-bg" />
          <div className="mb-1.5 h-3 w-full rounded bg-hover-bg" />
          <div className="h-3 w-5/6 rounded bg-hover-bg" />
        </div>
      ) : error ? (
        <div className="mb-4 flex items-center gap-2 rounded-sm border border-[var(--red-border)] bg-[var(--red-bg)] p-3 text-sm text-[var(--red)]">
          <AlertCircle className="h-4 w-4" />
          <span>{error.message}</span>
        </div>
      ) : filteredServers.length === 0 ? (
        <div className="rounded-sm border border-dashed border-card-border bg-card-bg p-10 text-center">
          <h3 className="text-base font-semibold text-foreground">
            No connectors found
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery
              ? "Try a different search keyword."
              : "Create a connector to connect external tools."}
          </p>
          {!searchQuery && (
            <button
              onClick={handleCreateNew}
              className="mt-4 bg-primary text-background px-4 py-2 text-sm font-medium rounded-sm hover:opacity-80 transition-opacity inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add Connector
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="bg-card-bg border border-card-border rounded-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-4 p-4 border-b border-card-border bg-tertiary/5 font-mono text-[10px] uppercase tracking-widest text-tertiary/40">
              <div className="col-span-12 md:col-span-5">Connector Integration</div>
              <div className="hidden md:block col-span-3">Status</div>
              <div className="hidden md:block col-span-3">Resources</div>
              <div className="hidden md:block col-span-1 text-right">Action</div>
            </div>
            {filteredServers.map((server, i) => (
              <ConnectorCard
                key={server.id}
                server={server}
                index={i}
                toolCount={(tools[server.id] ?? []).length}
                isLoadingTools={isLoadingServerTools[server.id]}
                onToggle={(e) => handleToggle(server, e)}
                onEdit={(e) => {
                  e.stopPropagation();
                  handleEdit(server);
                }}
                onDelete={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(server.id);
                }}
                onViewTools={() => handleViewTools(server)}
                isUsedInAgent={isServerUsedInAgent(server)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleCreateNew}
            className="mt-6 border border-dashed border-card-border w-full p-4 flex justify-center items-center gap-2 text-sm text-tertiary/40 hover:text-foreground hover:border-tertiary/60 rounded-sm cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Connector
          </button>
        </>
      )}

      <ConnectorToolsDialog
        isOpen={isToolsDialogOpen}
        onClose={() => setIsToolsDialogOpen(false)}
        server={selectedServer}
        tools={selectedServer ? tools[selectedServer.id] ?? [] : []}
        isLoadingTools={
          selectedServer ? !!isLoadingServerTools[selectedServer.id] : false
        }
        toolsError={selectedServer ? toolsError[selectedServer.id] ?? null : null}
        onRefresh={refreshTools}
        onToggle={(server) => handleToggle(server)}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        isDeleting={isDeleting !== null}
        title="Delete Connector"
        description="Are you sure you want to delete this connector? This action cannot be undone."
        dialogClassName="border border-card-border"
      />
    </ContentLayout>

  );
}
