"use client";

import { useState, useMemo } from "react";
import { Search, Hash } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AVAILABLE_VARIABLES } from "@/constants/variables";

interface VariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (variable: string) => void;
}

export function VariableDialog({
  open,
  onOpenChange,
  onInsert,
}: VariableDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredVariables = useMemo(() => {
    if (!searchQuery.trim()) {
      return AVAILABLE_VARIABLES;
    }

    const query = searchQuery.toLowerCase();
    return AVAILABLE_VARIABLES.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.value.toLowerCase().includes(query) ||
        v.description.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const handleInsert = (value: string) => {
    onInsert(value);
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) setSearchQuery("");
      }}
    >
      <DialogContent className="sm:max-w-[400px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Insert Variable
          </DialogTitle>
        </DialogHeader>

        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search variables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 bg-muted/50 border-transparent focus:bg-background focus:border-input transition-colors text-sm"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto py-1 px-1">
          {filteredVariables.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No variables found
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredVariables.map((variable) => (
                <button
                  key={variable.value}
                  onClick={() => handleInsert(variable.value)}
                  className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/80 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {variable.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                        {variable.description}
                      </span>
                    </div>
                  </div>
                  <code className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono group-hover:bg-background group-hover:text-foreground transition-colors">
                    {variable.value}
                  </code>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
