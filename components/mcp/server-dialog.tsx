import { useState } from "react";
import { Loader2, X, Globe, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MCPServerConfig, MCPTransportType } from "@/lib/types";

export const transportOptions = [
  { value: "http", label: "HTTP", icon: <Globe className="h-4 w-4" /> },
  {
    value: "sse",
    label: "Server-Sent Events (SSE)",
    icon: <Radio className="h-4 w-4" />,
  },
];

const approvalOptions = [
  { value: "never", label: "Never" },
  { value: "always", label: "Always" },
  { value: "per_tool", label: "Per Tool" },
];

type ApprovalType = "always" | "never" | "per_tool";

interface ServerSaveData {
  name: string;
  description?: string;
  transportType: MCPTransportType;
  serverUrl?: string;
  timeout: number;
  requireApproval: ApprovalType;
}

interface ServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ServerSaveData) => Promise<void>;
  initialData: Partial<MCPServerConfig> | null;
  isSaving: boolean;
}

interface ServerDialogBodyProps {
  onClose: () => void;
  onSave: (data: ServerSaveData) => Promise<void>;
  initialData: Partial<MCPServerConfig> | null;
  isSaving: boolean;
}

function ServerDialogBody({
  onClose,
  onSave,
  initialData,
  isSaving,
}: ServerDialogBodyProps) {
  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [transportType, setTransportType] = useState<MCPTransportType>(
    initialData?.transportType === "sse" ? "sse" : "http",
  );
  const [serverUrl, setServerUrl] = useState(initialData?.serverUrl || "");
  const [timeout, setTimeout] = useState(String(initialData?.timeout || 30000));
  const [requireApproval, setRequireApproval] = useState<ApprovalType>(
    initialData?.requireApproval || "never",
  );
  const isEditing = !!initialData?.id;

  const handleSave = async () => {
    if (!name.trim()) return;

    await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      transportType,
      serverUrl: serverUrl.trim(),
      timeout: parseInt(timeout) || 30000,
      requireApproval,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] p-0 gap-0 border border-modal-border/40 bg-modal-bg text-foreground overflow-hidden rounded-xl shadow-2xl flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-tertiary/10 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold text-tertiary">
              {isEditing ? "Edit Server" : "Add MCP Server"}
            </DialogTitle>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-tertiary/60 hover:text-tertiary hover:bg-tertiary/10 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-tertiary">
                Server Name
              </label>
              <Input
                placeholder="e.g., File System MCP"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-tertiary">
                Description{" "}
                <span className="text-tertiary/40 font-normal">(optional)</span>
              </label>
              <Input
                placeholder="What does this server do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-tertiary">
              Transport Type
            </label>
            <Select
              value={transportType}
              onChange={(v) => setTransportType(v as MCPTransportType)}
              options={transportOptions}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-tertiary">
              Server URL
            </label>
            <Input
              placeholder="https://example.com/mcp"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-tertiary">
                Timeout{" "}
                <span className="text-tertiary/40 font-normal">(ms)</span>
              </label>
              <Input
                type="number"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-tertiary">
                Tool Approval
              </label>
              <Select
                value={requireApproval}
                onChange={(v) => setRequireApproval(v as ApprovalType)}
                options={approvalOptions}
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-tertiary/10 flex items-center justify-end gap-3 bg-modal-bg/50 shrink-0">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
            className="px-5 h-10 text-tertiary hover:text-tertiary hover:bg-tertiary/10 rounded-lg font-medium"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              isSaving ||
              !name.trim() ||
              !serverUrl.trim()
            }
            className={cn(
              "px-5 h-10 rounded-lg font-medium transition-all",
              "bg-[#2A2825] text-tertiary border border-tertiary/20",
              "hover:bg-[#353230] hover:border-tertiary/30",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save Changes" : "Add Server"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ServerDialog({
  isOpen,
  onClose,
  onSave,
  initialData,
  isSaving,
}: ServerDialogProps) {
  if (!isOpen) return null;

  return (
    <ServerDialogBody
      key={initialData?.id ?? "new"}
      onClose={onClose}
      onSave={onSave}
      initialData={initialData}
      isSaving={isSaving}
    />
  );
}
