"use client";

import { logger } from "@/lib/logger";
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
import { Trash, Plus, Key, Lock, Loader2 } from "lucide-react";
import {
  useSecrets,
  useCreateSecret,
  useDeleteSecret,
} from "@/hooks/use-secrets-queries";

interface SecretListDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SecretListDialog({ isOpen, onClose }: SecretListDialogProps) {
  const { data: secrets = [], isLoading } = useSecrets(isOpen);
  const createSecret = useCreateSecret();
  const deleteSecret = useDeleteSecret();

  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSecretName.trim() || !newSecretValue.trim()) return;

    try {
      await createSecret.mutateAsync({
        name: newSecretName.trim(),
        value: newSecretValue.trim(),
      });
      setNewSecretName("");
      setNewSecretValue("");
    } catch (error) {
      logger.error("Failed to create secret:", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSecret.mutateAsync(id);
    } catch (error) {
      logger.error("Failed to delete secret:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Secret Management</DialogTitle>
              <DialogDescription>
                Manage environment variables and secrets available to your
                custom tools.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          <form
            onSubmit={handleCreate}
            className="flex gap-3 items-end p-4 bg-secondary/30 rounded-lg border border-border"
          >
            <div className="flex-1 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Name (Key)
              </label>
              <Input
                placeholder="e.g. API_KEY"
                value={newSecretName}
                onChange={(e) => setNewSecretName(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="flex-2 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Value
              </label>
              <Input
                type="password"
                placeholder="Secret value..."
                value={newSecretValue}
                onChange={(e) => setNewSecretValue(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={
                !newSecretName.trim() ||
                !newSecretValue.trim() ||
                createSecret.isPending
              }
            >
              {createSecret.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </form>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Existing Secrets
            </h3>
            {isLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 bg-secondary/50 animate-pulse rounded-lg"
                  />
                ))}
              </div>
            ) : secrets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
                No secrets defined yet.
              </div>
            ) : (
              secrets.map((secret) => (
                <div
                  key={secret.id}
                  className="flex items-center justify-between p-3 bg-card-bg border border-card-border rounded-lg group hover:border-primary/20 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="p-2 bg-secondary rounded text-muted-foreground">
                      <Key className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-medium truncate">
                        {secret.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {secret.value || "********"}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(secret.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    disabled={deleteSecret.isPending}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
