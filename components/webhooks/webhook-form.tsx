"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  useWebhook,
  useCreateWebhook,
  useUpdateWebhook,
  useRotateWebhookSecret,
} from "@/hooks/use-webhook-queries";
import { useAgents } from "@/hooks/use-agents-queries";
import { useWorkflows } from "@/hooks/use-workflows-queries";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { WebhookSecretReveal } from "@/components/webhooks/webhook-secret-reveal";
import { WebhookInvocations } from "@/components/webhooks/webhook-invocations";

interface WebhookFormProps {
  webhookId?: string;
}

export function WebhookForm({ webhookId }: WebhookFormProps) {
  const router = useRouter();
  const isEditMode = !!webhookId;

  // Data fetching
  const { data: webhook, isLoading: isLoadingWebhook } = useWebhook(
    webhookId ?? null,
  );
  const { data: agents = [] } = useAgents();
  const { data: workflows = [] } = useWorkflows();

  // Mutations
  const createMutation = useCreateWebhook();
  const updateMutation = useUpdateWebhook();
  const rotateMutation = useRotateWebhookSecret();

  // Form state
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [targetType, setTargetType] = React.useState<"workflow" | "agent">(
    "workflow",
  );
  const [targetId, setTargetId] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);

  // Modal state
  const [showSecretReveal, setShowSecretReveal] = React.useState(false);
  const [revealedSecret, setRevealedSecret] = React.useState("");
  const [revealedWebhookId, setRevealedWebhookId] = React.useState("");
  const [showRotateConfirm, setShowRotateConfirm] = React.useState(false);
  const [navigateOnClose, setNavigateOnClose] = React.useState(false);

  // Populate form in edit mode
  React.useEffect(() => {
    if (webhook) {
      setName(webhook.name);
      setDescription(webhook.description ?? "");
      setTargetType(webhook.target.type);
      setTargetId(webhook.target.id);
      setEnabled(webhook.enabled);
    }
  }, [webhook]);

  // Reset target selection when target type changes
  React.useEffect(() => {
    if (!isEditMode || !webhook) return;
    // Only reset if the user changes the type from what was loaded
    if (webhook.target.type !== targetType) {
      setTargetId("");
    }
  }, [targetType, isEditMode, webhook]);

  const targetOptions = React.useMemo(() => {
    if (targetType === "agent") {
      return agents.map((a) => ({ value: a.id, label: a.name }));
    }
    return workflows.map((w) => ({ value: w.id, label: w.name }));
  }, [targetType, agents, workflows]);

  const canSubmit = name.trim() !== "" && targetId !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      if (isEditMode && webhookId) {
        await updateMutation.mutateAsync({
          id: webhookId,
          updates: {
            name: name.trim(),
            description: description.trim() || undefined,
            target: { type: targetType, id: targetId },
            enabled,
          },
        });
        router.push("/webhooks");
      } else {
        const result = await createMutation.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          target: { type: targetType, id: targetId },
          enabled,
        });
        if (result.rawSecret) {
          setRevealedSecret(result.rawSecret);
          setRevealedWebhookId(result.id);
          setNavigateOnClose(true);
          setShowSecretReveal(true);
        } else {
          router.push("/webhooks");
        }
      }
    } catch {
      // Error is handled by react-query
    }
  };

  const handleRotateSecret = async () => {
    if (!webhookId) return;
    try {
      const result = await rotateMutation.mutateAsync(webhookId);
      setShowRotateConfirm(false);
      setRevealedSecret(result.rawSecret);
      setRevealedWebhookId(webhookId);
      setNavigateOnClose(false);
      setShowSecretReveal(true);
    } catch {
      setShowRotateConfirm(false);
    }
  };

  const handleSecretRevealClose = () => {
    setShowSecretReveal(false);
    setRevealedSecret("");
    if (navigateOnClose) {
      router.push("/webhooks");
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isEditMode && isLoadingWebhook) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isEditMode && !isLoadingWebhook && !webhook) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-6 text-center">
        <h3 className="mb-2 text-lg font-medium text-foreground">
          Webhook Not Found
        </h3>
        <p className="text-sm text-text-secondary">
          The webhook you are trying to edit does not exist.
        </p>
        <button
          onClick={() => router.push("/webhooks")}
          className="mt-4 text-sm font-medium text-primary hover:underline"
        >
          Back to Webhooks
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => router.push("/webhooks")}
          aria-label="Back to webhooks"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground">
          {isEditMode ? "Edit Webhook" : "Create Webhook"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div>
          <label
            htmlFor="webhook-name"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Name <span className="text-red-500">*</span>
          </label>
          <Input
            id="webhook-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My webhook"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="webhook-description"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Description
          </label>
          <Input
            id="webhook-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        {/* Target Type */}
        <div>
          <label
            htmlFor="webhook-target-type"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Target Type <span className="text-red-500">*</span>
          </label>
          <Select
            id="webhook-target-type"
            value={targetType}
            onChange={(value) => {
              setTargetType(value as "workflow" | "agent");
              if (!isEditMode) setTargetId("");
            }}
            options={[
              { value: "workflow", label: "Workflow" },
              { value: "agent", label: "Agent" },
            ]}
          />
        </div>

        {/* Target */}
        <div>
          <label
            htmlFor="webhook-target"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {targetType === "workflow" ? "Workflow" : "Agent"}{" "}
            <span className="text-red-500">*</span>
          </label>
          <Select
            id="webhook-target"
            value={targetId}
            onChange={setTargetId}
            options={targetOptions}
            placeholder={`Select a ${targetType}`}
            searchable
          />
        </div>

        {/* Enabled Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-card-border bg-card-bg p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enabled</p>
            <p className="text-xs text-text-secondary">
              When disabled, incoming requests will be rejected.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
              enabled ? "bg-primary" : "bg-card-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={!canSubmit || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "Save Changes" : "Create Webhook"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/webhooks")}
          >
            Cancel
          </Button>
          {isEditMode && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowRotateConfirm(true)}
              disabled={rotateMutation.isPending}
              className="ml-auto"
            >
              {rotateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="mr-2 h-4 w-4" />
              )}
              Rotate Secret
            </Button>
          )}
        </div>
      </form>

      {/* Invocations (edit mode only) */}
      {isEditMode && webhookId && (
        <div className="mt-8 border-t border-card-border pt-6">
          <WebhookInvocations webhookId={webhookId} />
        </div>
      )}

      {/* Rotate Secret Confirmation */}
      <DeleteConfirmationModal
        isOpen={showRotateConfirm}
        onClose={() => setShowRotateConfirm(false)}
        onConfirm={handleRotateSecret}
        isDeleting={rotateMutation.isPending}
        title="Rotate Webhook Secret"
        description="This will invalidate the current secret and generate a new one. Any integrations using the old secret will stop working. This action cannot be undone."
        confirmText="Rotate Secret"
        cancelText="Cancel"
      />

      {/* Secret Reveal Modal */}
      <WebhookSecretReveal
        open={showSecretReveal}
        onClose={handleSecretRevealClose}
        webhookId={revealedWebhookId}
        rawSecret={revealedSecret}
      />
    </div>
  );
}
