"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TableBlockProps {
  children?: React.ReactNode;
}

function getElementTypeName(type: unknown): string | null {
  if (typeof type === "string") {
    return type;
  }

  if (typeof type === "function") {
    return (
      (type as { displayName?: string; name?: string }).displayName ??
      (type as { name?: string }).name ??
      null
    );
  }

  return null;
}

// Helper to extract text content from table for copying
function extractTableText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";

  if (Array.isArray(node)) {
    return node.map(extractTableText).join("");
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    const { children } = element.props;
    const tagName = getElementTypeName(element.type);

    // Add appropriate separators based on element type
    if (tagName === "tr" || tagName === "TR" || tagName === "TableRow") {
      return extractTableText(children) + "\n";
    }
    if (
      tagName === "td" ||
      tagName === "TD" ||
      tagName === "th" ||
      tagName === "TH" ||
      tagName === "TableCell" ||
      tagName === "TableHeader"
    ) {
      return extractTableText(children) + "\t";
    }
    return extractTableText(children);
  }

  return "";
}

export function TableBlock({ children }: TableBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    const tableText = extractTableText(children);
    navigator.clipboard.writeText(tableText.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="relative group/table my-6">
      {/* Toolbar */}
      <div className="mb-2 flex justify-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md bg-surface-muted text-tertiary/60 hover:bg-tertiary/5 hover:text-foreground transition-colors"
          onClick={handleCopy}
          aria-label="Copy table"
          title="Copy table"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Table Container with scroll */}
      <div
        className="overflow-auto overscroll-contain touch-pan-x touch-pan-y rounded-xl border border-card-border bg-card-bg"
        style={{
          maxHeight: "min(65vh, 600px)",
          scrollbarGutter: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div className="min-w-full w-max">
          <div
            role="table"
            className="table w-full min-w-lg border-separate border-spacing-0 text-sm"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TableSectionProps {
  children?: React.ReactNode;
}

export function TableHeadSection({
  children,
  className,
  ...props
}: TableSectionProps & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="rowgroup"
      className={cn("table-header-group", className)}
      {...props}
    >
      {children}
    </div>
  );
}

TableHeadSection.displayName = "TableHeadSection";

export function TableBodySection({
  children,
  className,
  ...props
}: TableSectionProps & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="rowgroup"
      className={cn(
        "table-row-group [&>div:last-child>div]:border-b-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

TableBodySection.displayName = "TableBodySection";

interface TableHeaderProps {
  children?: React.ReactNode;
}

export function TableHeader({
  children,
  className,
  style,
  align,
  scope: _scope = undefined,
  abbr: _abbr = undefined,
  colSpan: _colSpan = undefined,
  rowSpan: _rowSpan = undefined,
  ...props
}: TableHeaderProps & React.ThHTMLAttributes<HTMLTableCellElement>) {
  void _scope; void _abbr; void _colSpan; void _rowSpan;
  const textAlignClass =
    align === "center"
      ? "text-center"
      : align === "right"
        ? "text-right"
        : "text-left";

  return (
    <div
      role="columnheader"
      className={cn(
        "table-cell px-4 py-3 align-top text-sm font-semibold text-foreground",
        "sticky top-0 z-10",
        "bg-card-bg",
        "border-b border-r border-card-border last:border-r-0",
        textAlignClass,
        className,
      )}
      style={style}
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
}

TableHeader.displayName = "TableHeader";

interface TableCellProps {
  children?: React.ReactNode;
}

export function TableCell({
  children,
  className,
  style,
  align,
  colSpan: _colSpan = undefined,
  rowSpan: _rowSpan = undefined,
  headers: _headers = undefined,
  ...props
}: TableCellProps & React.TdHTMLAttributes<HTMLTableCellElement>) {
  void _colSpan; void _rowSpan; void _headers;
  const textAlignClass =
    align === "center"
      ? "text-center"
      : align === "right"
        ? "text-right"
        : "text-left";

  return (
    <div
      role="cell"
      className={cn(
        "table-cell px-4 py-3 align-top text-sm text-tertiary/70",
        "bg-surface-muted",
        "border-b border-r border-card-border last:border-r-0",
        "transition-colors",
        textAlignClass,
        className,
      )}
      style={style}
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
}

TableCell.displayName = "TableCell";

interface TableRowProps {
  children?: React.ReactNode;
}

export function TableRow({
  children,
  className,
  ...props
}: TableRowProps & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <div
      role="row"
      className={cn("table-row hover:[&>div]:bg-tertiary/5", className)}
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
}

TableRow.displayName = "TableRow";

