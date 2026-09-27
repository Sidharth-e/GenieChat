import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Play, Sparkles, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeepResearchPlanCardProps {
  initialQueries: string[];
  onStartResearch: (finalPlan: string[]) => void;
  onCancel: () => void;
}

export function DeepResearchPlanCard({
  initialQueries,
  onStartResearch,
  onCancel,
}: DeepResearchPlanCardProps) {
  const [queries, setQueries] = React.useState<string[]>(initialQueries);
  const lastInputRef = React.useRef<HTMLInputElement>(null);

  const handleRemoveQuery = (index: number) => {
    setQueries(queries.filter((_, i) => i !== index));
  };

  const handleAddQuery = () => {
    setQueries([...queries, ""]);
    setTimeout(() => lastInputRef.current?.focus(), 50);
  };

  const handleQueryChange = (index: number, value: string) => {
    const next = [...queries];
    next[index] = value;
    setQueries(next);
  };

  const validQueries = queries.filter((q) => q.trim() !== "");

  return (
    <div className="w-full my-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-primary/10 shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Research Plan Ready
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review and edit search queries before starting
          </p>
        </div>
        <span className="text-xs font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-full shrink-0">
          {validQueries.length} quer{validQueries.length === 1 ? "y" : "ies"}
        </span>
      </div>

      {/* Query List */}
      <div className="rounded-xl border border-border bg-secondary/20 overflow-hidden mb-3">
        {queries.map((q, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 group transition-colors hover:bg-secondary/30",
              i < queries.length - 1 && "border-b border-border/50"
            )}
          >
            <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <Input
              ref={i === queries.length - 1 && q === "" ? lastInputRef : undefined}
              value={q}
              onChange={(e) => handleQueryChange(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddQuery();
              }}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 h-8 text-sm"
              placeholder="Search query..."
            />
            <button
              onClick={() => handleRemoveQuery(i)}
              className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
              aria-label="Remove query"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Button */}
      <button
        onClick={handleAddQuery}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-5 px-1 transition-colors group"
      >
        <div className="h-5 w-5 rounded-md border border-dashed border-border flex items-center justify-center group-hover:border-foreground/30 transition-colors">
          <Plus className="h-3 w-3" />
        </div>
        Add query
      </button>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onStartResearch(validQueries)}
          disabled={validQueries.length === 0}
        >
          <Play className="h-3.5 w-3.5 mr-2" />
          Start Research
        </Button>
      </div>
    </div>
  );
}
