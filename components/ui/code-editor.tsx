"use client";

import { logger } from "@/lib/logger";
import { useTheme } from "@/components/providers/theme-provider";
import CodeEditorUIW from "@uiw/react-textarea-code-editor";
import { useCallback, useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Wand2, Maximize2, Minimize2 } from "lucide-react";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}

/**
 * Simple JavaScript/JSON code formatter.
 */
function formatJavaScript(code: string): string {
  if (!code || code.trim().length === 0) return code;

  let formatted = "";
  let indentLevel = 0;
  let inString = false;
  let stringChar = "";
  let inComment = false;
  let inLineComment = false;

  const indent = () => "  ".repeat(indentLevel);

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = code[i + 1] || "";
    const prevChar = code[i - 1] || "";

    if ((char === '"' || char === "'" || char === "`") && prevChar !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = "";
      }
      formatted += char;
      continue;
    }

    if (inString) {
      formatted += char;
      continue;
    }

    if (char === "/" && nextChar === "/" && !inComment) {
      inLineComment = true;
      formatted += char;
      continue;
    }
    if (char === "/" && nextChar === "*" && !inLineComment) {
      inComment = true;
      formatted += char;
      continue;
    }
    if (char === "*" && nextChar === "/" && inComment) {
      inComment = false;
      formatted += char;
      continue;
    }
    if (char === "\n" && inLineComment) {
      inLineComment = false;
      formatted += char;
      continue;
    }

    if (inComment || inLineComment) {
      formatted += char;
      continue;
    }

    if (char === "{") {
      formatted += " {\n";
      indentLevel++;
      formatted += indent();
    } else if (char === "}") {
      indentLevel = Math.max(0, indentLevel - 1);
      formatted = formatted.trimEnd();
      formatted += "\n" + indent() + "}";
      if (
        nextChar &&
        nextChar !== ";" &&
        nextChar !== "," &&
        nextChar !== ")"
      ) {
        formatted += "\n" + indent();
      }
    } else if (char === ";") {
      formatted += ";\n" + indent();
    } else if (
      char === "," &&
      (prevChar === "}" || prevChar === "'" || prevChar === '"')
    ) {
      formatted += ",\n" + indent();
    } else if (char === "\n" || char === "\r") {
      continue;
    } else if (
      char === " " &&
      (prevChar === " " || prevChar === "\n" || formatted.endsWith(indent()))
    ) {
      continue;
    } else {
      formatted += char;
    }
  }

  return formatted
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
}

/**
 * The languages `formatCode` can actually format. Everything else — Python,
 * Bash, and anything a future node kind adds — must be returned untouched:
 * the fallback `formatJavaScript` does not throw on foreign input, it silently
 * re-indents it, and Python's significant indentation makes that a silent
 * change of meaning rather than a visible failure.
 */
const FORMATTABLE_LANGUAGES = new Set([
  "javascript",
  "js",
  "jsx",
  "typescript",
  "ts",
  "tsx",
  "json",
]);

/**
 * Textarea-based code editor with syntax highlighting using @uiw/react-textarea-code-editor
 */
export function CodeEditor({
  value,
  onChange,
  language = "javascript",
  height = "300px",
  placeholder,
  className,
  readOnly = false,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  const hasAutoFormatted = useRef(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const minEditorHeight = Number.parseInt(height, 10) || 300;

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (isFullScreen && e.key === "Escape") {
        setIsFullScreen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isFullScreen]);

  const formatCode = useCallback(() => {
    if (!value) return;

    if (!FORMATTABLE_LANGUAGES.has(language)) return;

    if (language === "json") {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        onChange(formatted);
      } catch {
        logger.warn("Invalid JSON, cannot format");
      }
    } else {
      const formatted = formatJavaScript(value);
      onChange(formatted);
    }
  }, [value, language, onChange]);

  // Auto-format minified code
  useEffect(() => {
    if (hasAutoFormatted.current) return;
    if (!value) return;

    const lines = value.split("\n");
    const isMinified = lines.length === 1 && value.length > 100;

    if (isMinified) {
      hasAutoFormatted.current = true;
      setTimeout(() => {
        formatCode();
      }, 100);
    }
  }, [value, formatCode]);

  return (
    <div
      ref={editorRef}
      className={cn(
        "relative overflow-hidden border border-input-border bg-input-bg transition-all duration-300 ease-in-out group",
        isFullScreen
          ? "fixed inset-0 z-100 h-screen w-screen rounded-none border-0"
          : "rounded-2xl focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10",
        className,
      )}
      style={!isFullScreen ? { height } : undefined}
    >
      {/* Toolbar */}
      {!readOnly && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={formatCode}
            className="flex items-center gap-1.5 rounded-lg bg-secondary/80 px-2.5 py-1.5 text-xs font-semibold text-foreground/70 backdrop-blur-sm transition-all hover:bg-primary hover:text-foreground shadow-sm border border-white/10"
            title="Format Code"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Format</span>
          </button>
          <button
            type="button"
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="flex items-center gap-1.5 rounded-lg bg-secondary/80 px-2.5 py-1.5 text-xs font-semibold text-foreground/70 backdrop-blur-sm transition-all hover:bg-primary hover:text-foreground shadow-sm border border-white/10"
            title={isFullScreen ? "Exit Full Screen (Esc)" : "Full Screen"}
          >
            {isFullScreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Exit</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Expand</span>
              </>
            )}
          </button>
        </div>
      )}

      <div className="h-full overflow-auto pt-4 pb-4">
        <CodeEditorUIW
          value={value}
          language={language}
          placeholder={placeholder}
          onChange={(evn) => onChange(evn.target.value)}
          disabled={readOnly}
          padding={15}
          minHeight={minEditorHeight}
          data-color-mode={resolvedTheme === "dark" ? "dark" : "light"}
          style={{
            fontSize: isFullScreen ? 16 : 14,
            fontFamily:
              "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
            backgroundColor: "transparent",
            minHeight: isFullScreen ? "100vh" : height,
          }}
        />
      </div>
    </div>
  );
}

