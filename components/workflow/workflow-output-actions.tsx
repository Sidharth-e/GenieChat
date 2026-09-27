import { logger } from "@/lib/logger";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Copy,
    Download,
    Check,
    Ellipsis,
    FileText,
    FileJson,
    ExternalLink,
    Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkflowOutputType } from "@/lib/types";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkflowOutputActionsProps {
    content: string;
    fileName?: string;
    title?: string;
    preferredFormat?: WorkflowOutputType;
    className?: string;
}

export function WorkflowOutputActions({
    content,
    fileName = "workflow-output.md",
    title = "Workflow Output",
    preferredFormat = "markdown",
    className
}: WorkflowOutputActionsProps) {
    const [isCopied, setIsCopied] = useState(false);
    const [isPlainCopied, setIsPlainCopied] = useState(false);

    const getFileBaseName = () => {
        const trimmed = fileName.trim();
        if (!trimmed) return "workflow-output";
        return trimmed.replace(/\.[^/.\\]+$/, "");
    };

    const getFileNameForExtension = (extension: "md" | "txt" | "json") => {
        return `${getFileBaseName()}.${extension}`;
    };

    const copyText = async (text: string) => {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
    };

    const toPlainText = (markdown: string) => {
        return markdown
            .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[\w-]*\n?/g, "").replace(/\n?```/g, ""))
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
            .replace(/~~([^~]+)~~/g, "$1")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    };

    const downloadFile = (fileContent: string, outputFileName: string, mimeType: string) => {
        const blob = new Blob([fileContent], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = outputFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const getJsonExport = () => {
        const plainText = toPlainText(content);

        return JSON.stringify(
            {
                title,
                exportedAt: new Date().toISOString(),
                format: "workflow-output",
                stats: {
                    characters: content.length,
                    words: plainText ? plainText.split(/\s+/).length : 0,
                },
                content,
            },
            null,
            2,
        );
    };

    const escapeHtml = (value: string) =>
        value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    const getStandaloneHtml = () => {
        const safeTitle = escapeHtml(title);
        const safeContent = escapeHtml(content);

        return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        margin: 0;
        padding: 24px;
        line-height: 1.6;
      }
      h1 {
        font-size: 18px;
        margin: 0 0 16px 0;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(127, 127, 127, 0.1);
        border-radius: 8px;
        padding: 16px;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    <pre>${safeContent}</pre>
  </body>
</html>`;
    };

    const handleCopy = async () => {
        try {
            await copyText(content);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            logger.error("Failed to copy text: ", err);
        }
    };

    const handleCopyPlainText = async () => {
        try {
            await copyText(toPlainText(content));
            setIsPlainCopied(true);
            setTimeout(() => setIsPlainCopied(false), 2000);
        } catch (err) {
            logger.error("Failed to copy plain text: ", err);
        }
    };

    const handleDownloadMarkdown = () => {
        try {
            downloadFile(content, getFileNameForExtension("md"), "text/markdown");
        } catch (err) {
            logger.error("Failed to download markdown file: ", err);
        }
    };

    const handleDownloadText = () => {
        try {
            downloadFile(toPlainText(content), getFileNameForExtension("txt"), "text/plain");
        } catch (err) {
            logger.error("Failed to download text file: ", err);
        }
    };

    const handleDownloadJson = () => {
        try {
            downloadFile(getJsonExport(), getFileNameForExtension("json"), "application/json");
        } catch (err) {
            logger.error("Failed to download JSON file: ", err);
        }
    };

    const handleOpenInNewTab = () => {
        try {
            const html = getStandaloneHtml();
            const blob = new Blob([html], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (err) {
            logger.error("Failed to open output in a new tab: ", err);
        }
    };

    const handlePrint = () => {
        try {
            const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
            if (!printWindow) return;

            printWindow.document.open();
            printWindow.document.write(getStandaloneHtml());
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        } catch (err) {
            logger.error("Failed to print output: ", err);
        }
    };

    const primaryExportLabel = preferredFormat === "json"
        ? "Export JSON"
        : preferredFormat === "text"
            ? "Export TXT"
            : "Export MD";

    const handlePrimaryExport = () => {
        if (preferredFormat === "json") {
            handleDownloadJson();
            return;
        }

        if (preferredFormat === "text") {
            handleDownloadText();
            return;
        }

        handleDownloadMarkdown();
    };

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-8 gap-1.5 text-xs text-tertiary hover:text-primary transition-colors hover:bg-tertiary/5"
            >
                {isCopied ? (
                    <>
                        <Check className="h-3.5 w-3.5 text-green-500" />
                        Copied
                    </>
                ) : (
                    <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                    </>
                )}
            </Button>

            <Button
                variant="outline"
                size="sm"
                onClick={handlePrimaryExport}
                className="h-8 gap-1.5 text-xs text-tertiary hover:text-primary transition-colors hover:bg-tertiary/5"
            >
                <Download className="h-3.5 w-3.5" />
                {primaryExportLabel}
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-tertiary hover:text-primary transition-colors hover:bg-tertiary/5"
                    >
                        <Ellipsis className="h-3.5 w-3.5" />
                        Actions
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={handleCopyPlainText}>
                        <FileText className="mr-2 h-3.5 w-3.5" />
                        {isPlainCopied ? "Copied Plain Text" : "Copy as Plain Text"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadText}>
                        <FileText className="mr-2 h-3.5 w-3.5" />
                        Download TXT
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadJson}>
                        <FileJson className="mr-2 h-3.5 w-3.5" />
                        Download JSON
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleOpenInNewTab}>
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        Open in New Tab
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePrint}>
                        <Printer className="mr-2 h-3.5 w-3.5" />
                        Print Output
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
