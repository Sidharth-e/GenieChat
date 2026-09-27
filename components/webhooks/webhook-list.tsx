"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Plus,
  AlertCircle,
  Copy,
  Check,
  Webhook as WebhookIcon,
} from "lucide-react";
import { useWebhooks, useDeleteWebhook } from "@/hooks/use-webhook-queries";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { ContentLayout } from "@/components/common/content-layout";
import { Webhook } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WebhookWithMeta extends Webhook {
  targetName: string;
}

export function WebhookList() {
  const router = useRouter();
  const { data: webhooks = [], isLoading, error } = useWebhooks();
  const deleteWebhookMutation = useDeleteWebhook();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<
    string | null
  >(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleCreate = () => router.push("/webhooks/new");
  const handleEdit = (wh: WebhookWithMeta) =>
    router.push(`/webhooks/${wh.id}/edit`);

  const handleDelete = async (id: string) => {
    await deleteWebhookMutation.mutateAsync(id);
    setShowDeleteConfirm(null);
  };

  const handleCopyUrl = async (id: string) => {
    const url = `${window.location.origin}/api/webhooks/${id}/trigger`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredWebhooks = webhooks.filter((wh) => {
    const query = searchQuery.toLowerCase();
    return (
      wh.name.toLowerCase().includes(query) ||
      (wh.description?.toLowerCase().includes(query) ?? false) ||
      (wh as WebhookWithMeta).targetName?.toLowerCase().includes(query)
    );
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <ContentLayout
      title="Webhooks"
      description="Let external systems trigger your agents and workflows"
      searchPlaceholder="Search webhooks..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      actionButton={
        <Button
          onClick={handleCreate}
          className="h-10 rounded-md px-4 shadow-none hover:scale-100"
        >
          New Webhook
          <Plus className="ml-2 h-4 w-4" />
        </Button>
      }
    >
      {isLoading && webhooks.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-md border border-card-border bg-card-bg p-4"
            >
              <div className="mb-2 h-4 w-2/3 rounded bg-hover-bg" />
              <div className="mb-1.5 h-3 w-full rounded bg-hover-bg" />
              <div className="mb-4 h-3 w-5/6 rounded bg-hover-bg" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          <span>
            {error instanceof Error ? error.message : "Failed to load webhooks"}
          </span>
        </div>
      ) : filteredWebhooks.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
          <h3 className="text-base font-semibold text-foreground">
            No webhooks found
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery
              ? "Try a different search keyword."
              : "Create a webhook to let external systems trigger your agents and workflows."}
          </p>
          {!searchQuery && (
            <Button
              onClick={handleCreate}
              className="mt-4 h-9 rounded-md px-4 shadow-none hover:scale-100"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Webhook
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredWebhooks.map((wh) => {
            const whMeta = wh as WebhookWithMeta;
            return (
              <div
                key={wh.id}
                onClick={() => handleEdit(whMeta)}
                className="group cursor-pointer rounded-md border border-card-border bg-card-bg p-4 transition-colors hover:bg-hover-bg"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <WebhookIcon className="h-4 w-4 text-text-secondary" />
                    <h3 className="truncate text-sm font-medium text-foreground">
                      {wh.name}
                    </h3>
                  </div>
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      wh.enabled ? "bg-green-500" : "bg-text-tertiary",
                    )}
                    title={wh.enabled ? "Enabled" : "Disabled"}
                  />
                </div>
                {wh.description && (
                  <p className="mb-2 line-clamp-2 text-xs text-text-secondary">
                    {wh.description}
                  </p>
                )}
                <div className="mb-3 text-xs text-text-tertiary">
                  <span className="capitalize">{wh.target.type}</span>
                  <span className="mx-1">&middot;</span>
                  <span>{whMeta.targetName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">
                    {formatDate(wh.lastTriggeredAt)}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyUrl(wh.id);
                      }}
                      className="rounded p-1 text-text-tertiary hover:bg-hover-bg hover:text-text-secondary"
                      title="Copy webhook URL"
                    >
                      {copiedId === wh.id ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(wh.id);
                      }}
                      className="rounded p-1 text-text-tertiary hover:bg-hover-bg hover:text-red-500"
                      title="Delete webhook"
                    >
                      <span className="text-xs">&#x2715;</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        isDeleting={deleteWebhookMutation.isPending}
        title="Delete Webhook"
        description="Are you sure you want to delete this webhook? All invocation history will be lost. This action cannot be undone."
        dialogClassName="border border-card-border"
      />
    </ContentLayout>
  );
}
