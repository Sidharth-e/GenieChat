"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  ExternalLink,
} from "lucide-react";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/hooks/use-api-keys-queries";
import { Agent } from "@/lib/types";

interface ApiKeyDialogProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
}

export function ApiKeyDialog({ agent, isOpen, onClose }: ApiKeyDialogProps) {
  const { data: allKeys = [], isLoading } = useApiKeys(isOpen);
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [newKeyName, setNewKeyName] = useState("");
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Filter keys that have access to this agent
  const agentKeys = allKeys.filter(
    (k) =>
      !k.revoked &&
      (k.scopes.includes("*") || k.scopes.includes(agent.id)),
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      const result = await createKey.mutateAsync({
        name: newKeyName.trim(),
        scopes: [agent.id],
      });
      setCreatedRawKey(result.key);
      setNewKeyName("");
    } catch {
      // error handled by mutation
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeKey.mutateAsync(id);
    } catch {
      // error handled by mutation
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <ExternalLink className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>API Access — {agent.name}</DialogTitle>
              <DialogDescription>
                Generate API keys to use this agent from external applications
                via OpenAI-compatible endpoints.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-5">
          {/* Created key banner — only shown once after creation */}
          {createdRawKey && (
            <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
              <p className="text-sm font-medium text-primary">
                API Key Created — Copy it now, it won&apos;t be shown again!
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-secondary p-2 rounded font-mono break-all select-all">
                  {createdRawKey}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() =>
                    copyToClipboard(createdRawKey, "created-key")
                  }
                >
                  {copiedField === "created-key" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-foreground/50"
                onClick={() => setCreatedRawKey(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Create new key */}
          <form
            onSubmit={handleCreate}
            className="flex gap-3 items-end p-4 bg-secondary/30 rounded-lg border border-border"
          >
            <div className="flex-1 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Key Name
              </label>
              <Input
                placeholder="e.g. My Integration"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={!newKeyName.trim() || createKey.isPending}
            >
              {createKey.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Generate Key
            </Button>
          </form>

          {/* Existing keys */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Active Keys
            </h3>
            {isLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 bg-secondary/50 animate-pulse rounded-lg"
                  />
                ))}
              </div>
            ) : agentKeys.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
                No API keys for this agent yet.
              </div>
            ) : (
              agentKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-3 bg-card-bg border border-card-border rounded-lg group hover:border-primary/20 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="p-2 bg-secondary rounded text-muted-foreground">
                      <Key className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {key.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {key.keyPrefix}
                        {key.lastUsedAt && (
                          <span className="ml-2 text-foreground/30">
                            Last used{" "}
                            {new Date(key.lastUsedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(key.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    disabled={revokeKey.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Usage examples */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Quick Start
            </h3>

            {/* Endpoint URLs */}
            <div className="p-3 bg-secondary/30 rounded-lg border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Chat Completions Endpoint
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    copyToClipboard(
                      `${baseUrl}/api/agents/v1/chat/completions`,
                      "endpoint-chat",
                    )
                  }
                >
                  {copiedField === "endpoint-chat" ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <code className="block text-xs font-mono text-foreground/70 break-all">
                {baseUrl}/api/agents/v1/chat/completions
              </code>
            </div>

            {/* curl example */}
            <div className="relative p-3 bg-secondary/30 rounded-lg border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  curl Example
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    copyToClipboard(
                      `curl ${baseUrl}/api/agents/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -d '{"model": "${agent.id}", "messages": [{"role": "user", "content": "Hello"}], "stream": false}'`,
                      "curl",
                    )
                  }
                >
                  {copiedField === "curl" ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed">
{`curl ${baseUrl}/api/agents/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "${agent.id}",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'`}
              </pre>
            </div>

            {/* OpenAI SDK example */}
            <div className="relative p-3 bg-secondary/30 rounded-lg border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  OpenAI Python SDK
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    copyToClipboard(
                      `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}/api/agents/v1",\n    api_key="YOUR_API_KEY"\n)\n\nresponse = client.chat.completions.create(\n    model="${agent.id}",\n    messages=[{"role": "user", "content": "Hello"}]\n)\nprint(response.choices[0].message.content)`,
                      "python",
                    )
                  }
                >
                  {copiedField === "python" ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed">
{`from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/api/agents/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="${agent.id}",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)`}
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
