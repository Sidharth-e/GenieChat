"use client";

import { Info } from "lucide-react";

interface BasicInfoSectionProps {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
}

export function BasicInfoSection({
  name,
  setName,
  description,
  setDescription,
}: BasicInfoSectionProps) {
  return (
    <section id="agent-basic-info" className="space-y-5 scroll-mt-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
          <Info className="h-4.5 w-4.5" />
        </div>
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">
            Basic Info
          </h2>
          <p className="text-[13px] text-foreground/50 leading-relaxed">
            Give your agent a unique name and a clear description of its
            purpose.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45 ml-0.5">
            Agent Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input-border bg-input-bg px-3.5 py-2.5 text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-foreground placeholder:text-foreground/25"
            placeholder="e.g. Research Specialist"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45 ml-0.5">
            Purpose
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-input-border bg-input-bg px-3.5 py-2.5 text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-foreground placeholder:text-foreground/25"
            placeholder="Briefly state intended use"
          />
        </div>
      </div>
    </section>
  );
}
