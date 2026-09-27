import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CustomTool, CustomToolParameter } from "@/lib/types";
import { FormDialog } from "@/components/common/form-dialog";

interface ToolDialogSaveData {
  name: string;
  description: string;
  code: string;
  parameters: CustomToolParameter[];
  enabled: boolean;
}

interface ToolDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ToolDialogSaveData) => Promise<void>;
  initialData: Partial<CustomTool> | null;
  isSaving: boolean;
}

function ToolDialogBody({
  onClose,
  onSave,
  initialData,
  isSaving,
}: Omit<ToolDialogProps, "isOpen">) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [code, setCode] = useState(initialData?.code ?? "");
  const [parameters, setParameters] = useState(
    initialData?.parameters
      ? JSON.stringify(initialData.parameters, null, 2)
      : "",
  );
  const isEditing = !!initialData?.id;

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return;

    let parsedParams: CustomToolParameter[] = [];
    try {
      if (parameters.trim()) {
        parsedParams = JSON.parse(parameters) as CustomToolParameter[];
      }
    } catch {
      parsedParams = [];
    }

    await onSave({
      name: name.trim(),
      description: description.trim(),
      code: code.trim(),
      parameters: parsedParams,
      enabled: true,
    });
  };

  return (
    <FormDialog
      isOpen={true}
      onClose={onClose}
      title={isEditing ? "Edit Tool" : "Create Custom Tool"}
      onSubmit={handleSave}
      isSubmitting={isSaving}
      submitDisabled={!name.trim() || !code.trim()}
      submitLabel={isEditing ? "Save Changes" : "Create Tool"}
      cancelClassName="px-5 h-10 text-tertiary hover:text-tertiary hover:bg-tertiary/10 rounded-lg font-medium"
      submitClassName="px-5 h-10 bg-[#2A2825] text-tertiary border border-tertiary/20 hover:bg-[#353230] hover:border-tertiary/30"
      bodyClassName="space-y-4"
      footerClassName="bg-modal-bg/50"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-tertiary">
            Tool Name
          </label>
          <Input
            placeholder="e.g., calculate_sum"
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
            placeholder="What does this tool do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-tertiary">
          JavaScript Code
        </label>
        <Textarea
          placeholder={`// Your tool code here\n// Access parameters via 'params' object\n// Return a result object\n\nconst result = params.a + params.b;\nreturn { sum: result };`}
          className="min-h-[200px] font-mono text-sm bg-input-bg border border-input-border text-foreground placeholder:text-text-secondary focus:outline-none focus:border-primary rounded-lg resize-y"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-tertiary">
          Parameters Schema{" "}
          <span className="text-tertiary/40 font-normal">(JSON array)</span>
        </label>
        <Textarea
          placeholder={`[\n  { "name": "a", "type": "number", "description": "First number", "required": true },\n  { "name": "b", "type": "number", "description": "Second number", "required": true }\n]`}
          className="min-h-[100px] font-mono text-sm bg-input-bg border border-input-border text-foreground placeholder:text-text-secondary focus:outline-none focus:border-primary rounded-lg resize-y"
          value={parameters}
          onChange={(e) => setParameters(e.target.value)}
        />
      </div>
    </FormDialog>
  );
}

export function ToolDialog({
  isOpen,
  onClose,
  onSave,
  initialData,
  isSaving,
}: ToolDialogProps) {
  if (!isOpen) return null;

  return (
    <ToolDialogBody
      key={initialData?.id ?? "new"}
      onClose={onClose}
      onSave={onSave}
      initialData={initialData}
      isSaving={isSaving}
    />
  );
}
