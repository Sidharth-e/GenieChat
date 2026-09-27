"use client";

import { useState } from "react";
import { Loader2, AlertCircle, Send, Key, Copy, Check, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ContentLayout } from "@/components/common/content-layout";
import { MarkdownRenderer } from "@/components/common/markdown-renderer";
import { useSubmitAutoTask, useAutoTaskStatus } from "@/hooks/use-auto";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/hooks/use-api-keys-queries";

function AutoApiKeySection() {
  const { data: allKeys = [], isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const autoKeys = allKeys.filter(
    (k) => !k.revoked && (k.scopes.includes("auto") || k.scopes.includes("*")),
  );

  function handleCreate() {
    createKey.mutate(
      { name: "Auto Desktop Agent", scopes: ["auto"] },
      { onSuccess: (data) => setCreatedRawKey(data.key) },
    );
  }

  function copyKey() {
    if (!createdRawKey) return;
    navigator.clipboard.writeText(createdRawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-md border border-card-border bg-card-bg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-text-secondary" />
          <span className="text-sm font-medium">API Key for Auto.exe</span>
        </div>
        {autoKeys.length === 0 && !createdRawKey && (
          <Button
            onClick={handleCreate}
            disabled={createKey.isPending}
            size="sm"
            variant="outline"
          >
            {createKey.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Plus className="h-3 w-3 mr-1" />
            )}
            Generate Key
          </Button>
        )}
      </div>

      {createdRawKey && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
          <p className="text-xs font-medium text-primary">
            Copy this key now — it won&apos;t be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-secondary p-2 rounded font-mono break-all select-all">
              {createdRawKey}
            </code>
            <Button variant="ghost" size="icon" className="shrink-0" onClick={copyKey}>
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-text-secondary">
            Set this as <code className="bg-secondary px-1 rounded">AUTO_API_KEY</code> in your Auto .env file
          </p>
        </div>
      )}

      {!isLoading && autoKeys.length > 0 && (
        <div className="space-y-1">
          {autoKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between p-2 rounded group hover:bg-secondary/30">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-secondary">{key.name}</span>
                <code className="text-xs text-text-secondary/60 font-mono">{key.keyPrefix}</code>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 text-red-500"
                onClick={() => revokeKey.mutate(key.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {!isLoading && autoKeys.length === 0 && !createdRawKey && (
        <p className="text-xs text-text-secondary">
          Generate an API key to connect your Auto desktop agent.
        </p>
      )}
    </div>
  );
}

export default function AutoPage() {
  const [task, setTask] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const submitTask = useSubmitAutoTask();
  const taskStatus = useAutoTaskStatus(activeTaskId);

  const isWorking = submitTask.isPending ||
    (taskStatus.data?.status === "pending") ||
    (taskStatus.data?.status === "running");

  function handleSubmit() {
    const trimmed = task.trim();
    if (!trimmed || isWorking) return;
    setActiveTaskId(null);
    submitTask.mutate(trimmed, {
      onSuccess: (data) => setActiveTaskId(data.id),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const statusLabel = taskStatus.data?.status === "running"
    ? "Auto is executing your task..."
    : taskStatus.data?.status === "pending"
      ? "Waiting for Auto to pick up task..."
      : null;

  return (
    <div className="h-full w-full overflow-y-auto">
      <ContentLayout
        title="Auto"
        description="Send tasks to Auto — browser automation, web search, desktop control, and file operations powered by multi-agent orchestration."
      >
        <div className="space-y-4">
          <AutoApiKeySection />

          <div className="flex gap-2">
            <Textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe a task... (e.g., search for latest Python version, open a website, find trending repos)"
              className="min-h-[80px] resize-none"
              disabled={isWorking}
            />
            <Button
              onClick={handleSubmit}
              disabled={!task.trim() || isWorking}
              className="h-auto self-end px-4"
            >
              {isWorking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {statusLabel && (
            <div className="rounded-md border border-card-border bg-card-bg p-6 text-center space-y-3">
              <div className="flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
              <p className="text-sm text-text-secondary">{statusLabel}</p>
            </div>
          )}

          {submitTask.isError && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{submitTask.error.message}</span>
            </div>
          )}

          {taskStatus.data?.status === "failed" && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{taskStatus.data.error || "Task failed"}</span>
            </div>
          )}

          {taskStatus.data?.status === "completed" && taskStatus.data.result && (
            <div className="rounded-md border border-card-border bg-card-bg p-6">
              <MarkdownRenderer content={taskStatus.data.result} />
            </div>
          )}
        </div>
      </ContentLayout>
    </div>
  );
}
