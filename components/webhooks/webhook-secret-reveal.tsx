"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Copy, AlertTriangle } from "lucide-react";

interface WebhookSecretRevealProps {
  open: boolean;
  onClose: () => void;
  webhookId: string;
  rawSecret: string;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

export function WebhookSecretReveal({
  open,
  onClose,
  webhookId,
  rawSecret,
}: WebhookSecretRevealProps) {
  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/${webhookId}/trigger`;

  const curlExample = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-secret: ${rawSecret}" \\
  -d '{"message": "Hello from webhook"}'`;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Webhook Created</DialogTitle>
          <DialogDescription>
            Save these credentials now. The secret will not be shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800 dark:text-amber-300" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              This is the only time the raw secret will be displayed. Store it
              securely. If you lose it, you will need to rotate the secret to
              generate a new one.
            </p>
          </div>

          {/* Webhook URL */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Webhook URL
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-card-border bg-card-bg p-2">
              <code className="flex-1 break-all text-xs text-foreground">
                {webhookUrl}
              </code>
              <CopyButton value={webhookUrl} label="webhook URL" />
            </div>
          </div>

          {/* Secret */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Secret
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-card-border bg-card-bg p-2">
              <code className="flex-1 break-all font-mono text-xs text-foreground">
                {rawSecret}
              </code>
              <CopyButton value={rawSecret} label="secret" />
            </div>
          </div>

          {/* Curl Example */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Example Request
            </label>
            <div className="relative rounded-lg border border-card-border bg-card-bg p-3">
              <pre className="overflow-x-auto text-xs text-text-secondary whitespace-pre-wrap">
                {curlExample}
              </pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={curlExample} label="curl command" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
