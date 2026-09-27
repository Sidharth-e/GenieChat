"use client";

import { Wand2, Variable, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";

interface BehaviorSectionProps {
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  temperature: number;
  setTemperature: (value: number) => void;
  topP: number;
  setTopP: (value: number) => void;
  onOpenPromptDialog: () => void;
  onOpenVariableDialog: () => void;
}

export function BehaviorSection({
  systemPrompt,
  setSystemPrompt,
  model,
  setModel,
  temperature,
  setTemperature,
  topP,
  setTopP,
  onOpenPromptDialog,
  onOpenVariableDialog,
}: BehaviorSectionProps) {
  const selectedModel = AVAILABLE_MODELS.find(
    (available) => available.id === model,
  );
  const supportsTemperature = selectedModel?.supportsTemperature ?? false;
  const supportsTopP = selectedModel?.supportsTopP ?? false;

  return (
    <section id="agent-behavior" className="space-y-5 scroll-mt-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
          <Settings className="h-4.5 w-4.5" />
        </div>
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">
            Behavior
          </h2>
          <p className="text-[13px] text-foreground/50 leading-relaxed">
            Define how the agent interacts and solves problems.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* System Instructions */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-primary ml-0.5">
              System Instructions
            </label>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenPromptDialog}
                className="h-7 w-7 text-foreground/40 hover:text-primary hover:bg-primary/8 rounded-md"
                title="Generate / Tailor"
              >
                <Wand2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenVariableDialog}
                className="h-7 w-7 text-foreground/40 hover:text-primary hover:bg-primary/8 rounded-md"
                title="Insert Variable"
              >
                <Variable className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full rounded-lg border border-input-border bg-input-bg px-3.5 py-3 text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-foreground min-h-[160px] resize-none leading-relaxed placeholder:text-foreground/25"
            placeholder="Compose detailed instructions for your agent..."
          />
        </div>

        {/* Model selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45 ml-0.5">
            Model
          </label>
          <Select
            value={model}
            onChange={(v) => setModel(v)}
            options={AVAILABLE_MODELS.filter((m) => m.supportsTools).map((m) => ({
              value: m.id,
              label: `${m.name} (${m.provider})`,
            }))}
          />
        </div>

        {/* Temperature & Top P */}
        {(supportsTemperature || supportsTopP) && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {supportsTemperature && (
              <div className="space-y-3 rounded-xl border border-input-border bg-card-bg/50 p-4">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45">
                    Temperature
                  </label>
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-primary h-1.5 rounded-full"
                />
                <p className="text-[11px] text-foreground/40 leading-relaxed">
                  Lower is more deterministic, higher is more creative.
                </p>
              </div>
            )}
            {supportsTopP && (
              <div className="space-y-3 rounded-xl border border-input-border bg-card-bg/50 p-4">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45">
                    Top P
                  </label>
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {topP.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={topP}
                  onChange={(e) => setTopP(Number(e.target.value))}
                  className="w-full accent-primary h-1.5 rounded-full"
                />
                <p className="text-[11px] text-foreground/40 leading-relaxed">
                  Controls nucleus sampling breadth for token selection.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
