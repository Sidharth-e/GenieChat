"use client";

import { memo } from "react";
import { useReactFlow } from "@xyflow/react";
import type { CodeNodeData, UINode } from "@/lib/workflow/types";
import { CodeEditor } from "@/components/ui/code-editor";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "bash", label: "Bash" },
];

export const CodeNodeConfig = memo(function CodeNodeConfig({
  data,
}: {
  data: CodeNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();
  const language = data.language ?? "python";

  return (
    <div className="flex flex-col gap-3 px-4">
      <div>
        <p className="text-sm font-medium mb-1.5">Language</p>
        <Select
          value={language}
          onChange={(value) =>
            updateNodeData(data.id, { language: value as CodeNodeData["language"] })
          }
          options={LANGUAGES}
          size="sm"
        />
      </div>

      <Separator />

      <div>
        <p className="text-sm font-medium mb-1.5">Code</p>
        <CodeEditor
          value={data.code ?? ""}
          onChange={(code) => updateNodeData(data.id, { code })}
          language={language}
          height="220px"
          placeholder={
            language === "bash" ? "echo hello" : "print('hello')"
          }
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Runs in the sandbox. Stdout, stderr and the exit code become this
        node&apos;s output.
      </p>
    </div>
  );
});
CodeNodeConfig.displayName = "CodeNodeConfig";
