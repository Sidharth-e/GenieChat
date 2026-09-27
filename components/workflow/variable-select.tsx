"use client";

import { useReactFlow } from "@xyflow/react";
import type { UINode, JsonSchema7 } from "@/lib/workflow/types";
import { Variable, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { findAccessibleNodeIds } from "@/lib/workflow/shared";
import { cn } from "@/lib/utils";

interface VariableSelectProps {
  currentNodeId: string;
  allowedTypes?: string[];
  children: React.ReactNode;
  onChange: (item: {
    nodeId: string;
    path: string[];
    nodeName: string;
    type: string;
  }) => void;
}

export function VariableSelect({
  currentNodeId,
  onChange,
  children,
  allowedTypes,
}: VariableSelectProps) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 bg-secondary border-card-border">
        <VariableSelectContent
          currentNodeId={currentNodeId}
          allowedTypes={allowedTypes}
          onClose={() => setOpen(false)}
          onChange={(item) => {
            onChange(item);
            setOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Exported so it can also be used in the mention input suggestion popup
export function VariableSelectContent({
  currentNodeId,
  onChange,
  allowedTypes,
  onClose,
}: Omit<VariableSelectProps, "children"> & { onClose?: () => void }) {
  const [query, setQuery] = useState("");
  const { getNodes, getEdges } = useReactFlow<UINode>();
  const nodes = getNodes();
  const edges = getEdges();

  const accessibleSchemas = useMemo(() => {
    const accessibleIds = findAccessibleNodeIds({
      nodeId: currentNodeId,
      nodes: nodes.map((n) => n.data),
      edges,
    });
    return nodes
      .filter((n) => accessibleIds.includes(n.id))
      .map((n) => ({
        id: n.data.id,
        name: n.data.name,
        schema: n.data.outputSchema?.properties,
      }))
      .filter((v) => v.schema && Object.keys(v.schema).length);
  }, [nodes, currentNodeId, edges]);

  const filteredNodes = useMemo(() => {
    return accessibleSchemas
      .map(({ name, id, schema }) => {
        const items = Object.entries(schema ?? {})
          .filter(([key]) => key.toLowerCase().includes(query.toLowerCase()))
          .map(([key, schemaValue]: [string, JsonSchema7]) => {
            const disabled =
              allowedTypes?.length && !allowedTypes.includes(schemaValue?.type ?? "");

            // For object types with properties, render a sub-menu
            if (
              schemaValue?.type === "object" &&
              schemaValue?.properties &&
              Object.keys(schemaValue.properties).length > 0
            ) {
              return (
                <DropdownMenuSub key={key}>
                  <DropdownMenuSubTrigger
                    className="text-xs"
                    onClick={() => {
                      if (!disabled)
                        onChange({
                          nodeId: id,
                          path: [key],
                          nodeName: name,
                          type: schemaValue.type ?? "object",
                        });
                    }}
                  >
                    <Variable className="size-3.5 text-primary" />
                    <span
                      className={cn(
                        "truncate",
                        disabled && "text-muted-foreground",
                      )}
                    >
                      {key}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto mr-1">
                      {schemaValue.type}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-96 overflow-y-auto bg-secondary border-card-border">
                    {Object.entries(schemaValue.properties).map(
                      ([subKey, subSchema]: [string, JsonSchema7]) => (
                        <DropdownMenuItem
                          key={subKey}
                          disabled={
                            !!(
                              allowedTypes?.length &&
                              !allowedTypes.includes(subSchema?.type ?? "")
                            )
                          }
                          onClick={() =>
                            onChange({
                              nodeId: id,
                              path: [key, subKey],
                              nodeName: name,
                              type: subSchema?.type ?? "string",
                            })
                          }
                        >
                          <Variable className="size-3.5 text-primary" />
                          <span className="truncate">{subKey}</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {subSchema?.type}
                          </span>
                        </DropdownMenuItem>
                      ),
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            }

            return (
              <DropdownMenuItem
                key={key}
                disabled={!!disabled}
                onClick={() =>
                  onChange({
                    nodeId: id,
                    path: [key],
                    nodeName: name,
                    type: schemaValue?.type ?? "string",
                  })
                }
              >
                <Variable className="size-3.5 text-primary" />
                <span className="truncate">{key}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {schemaValue?.type}
                </span>
              </DropdownMenuItem>
            );
          });

        if (!items.length) return null;
        return (
          <DropdownMenuGroup key={id}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {name}
            </DropdownMenuLabel>
            {items}
          </DropdownMenuGroup>
        );
      })
      .filter(Boolean);
  }, [accessibleSchemas, query, allowedTypes, onChange]);

  return (
    <div className="flex flex-col w-full">
      <div
        className="flex items-center gap-1 px-2"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Search className="size-4 text-muted-foreground shrink-0" />
        <Input
          autoFocus
          className="border-none bg-transparent h-8 text-sm"
          placeholder="Search variables..."
          value={query}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose?.();
            if (e.key === "Backspace" && query.length === 0) onClose?.();
          }}
          onChange={(e) => {
            e.stopPropagation();
            setQuery(e.target.value);
          }}
        />
      </div>
      <DropdownMenuSeparator />
      <div className="max-h-[50vh] overflow-y-auto flex flex-col">
        {filteredNodes.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <p className="text-muted-foreground text-xs">No variables found</p>
          </div>
        ) : (
          filteredNodes
        )}
      </div>
    </div>
  );
}
