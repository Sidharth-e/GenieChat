"use client";

import * as React from "react";
import { useWebhookInvocations } from "@/hooks/use-webhook-queries";
import { WebhookInvocation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, AlertCircle } from "lucide-react";

interface WebhookInvocationsProps {
  webhookId: string;
}

function StatusDot({ status }: { status: WebhookInvocation["status"] }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "completed" && "bg-green-500",
        status === "running" && "bg-blue-500 animate-pulse",
        status === "pending" && "bg-amber-500",
        status === "failed" && "bg-red-500",
      )}
    />
  );
}

function InvocationRow({ invocation }: { invocation: WebhookInvocation }) {
  const [expanded, setExpanded] = React.useState(false);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="border-b border-card-border last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs hover:bg-hover-bg"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
        )}
        <StatusDot status={invocation.status} />
        <span className="flex-1 text-text-secondary">{formatDate(invocation.triggeredAt)}</span>
        <span className="text-text-tertiary capitalize">{invocation.status}</span>
        <span className="w-16 text-right text-text-tertiary">{formatDuration(invocation.durationMs)}</span>
      </button>
      {expanded && (
        <div className="space-y-2 bg-hover-bg/50 px-3 py-3 text-xs">
          {invocation.error && (
            <div className="flex items-start gap-1.5 text-red-500">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{invocation.error}</span>
            </div>
          )}
          <div>
            <span className="font-medium text-text-secondary">Payload</span>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-card-bg p-2 text-text-tertiary">
              {JSON.stringify(invocation.payload, null, 2)}
            </pre>
          </div>
          {invocation.executionId && (
            <div className="text-text-tertiary">
              <span className="font-medium text-text-secondary">Execution ID: </span>
              {invocation.executionId}
            </div>
          )}
          {invocation.sourceIp && (
            <div className="text-text-tertiary">
              <span className="font-medium text-text-secondary">Source: </span>
              {invocation.sourceIp}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WebhookInvocations({ webhookId }: WebhookInvocationsProps) {
  const { data: invocations = [], isLoading } = useWebhookInvocations(webhookId);

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-foreground">Recent Invocations</h2>
      {isLoading ? (
        <div className="rounded-md border border-card-border bg-card-bg p-4 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-hover-bg" />
        </div>
      ) : invocations.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-6 text-center text-sm text-text-secondary">
          No invocations yet. Trigger this webhook to see execution history.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-card-border bg-card-bg">
          {invocations.map((inv) => (
            <InvocationRow key={inv.id} invocation={inv} />
          ))}
        </div>
      )}
    </div>
  );
}
