"use client";

import { logger } from "@/lib/logger";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentDocument } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_FORMATS_LABEL,
} from "@/lib/document-file-support";

interface DocumentUploadSectionProps {
  agentId?: string;
  documents: AgentDocument[];
  onDocumentsChange: (documents: AgentDocument[]) => void;
  onPendingFilesChange?: (files: File[]) => void;
  isNewAgent?: boolean;
}

type UploadStageKey =
  | "uploading"
  | "extracting"
  | "splitting"
  | "vectorizing"
  | "indexing";

interface UploadEstimates {
  pageCount: number;
  chunkCount: number;
}

interface UploadProgressState {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  stage: UploadStageKey;
  stageLabel: string;
  stageIndex: number;
  stageTotal: number;
  processedUnits: number;
  totalUnits: number;
  unitLabel: string;
}

const UPLOAD_PROGRESS_STAGES: Array<{
  key: UploadStageKey;
  label: string;
  start: number;
  end: number;
  unitLabel: string;
  getTotalUnits: (estimates: UploadEstimates) => number;
}> = [
  {
    key: "uploading",
    label: "Uploading document",
    start: 0,
    end: 0.2,
    unitLabel: "parts",
    getTotalUnits: () => 100,
  },
  {
    key: "extracting",
    label: "Extracting text",
    start: 0.2,
    end: 0.38,
    unitLabel: "pages",
    getTotalUnits: (estimates) => estimates.pageCount,
  },
  {
    key: "splitting",
    label: "Splitting chunks",
    start: 0.38,
    end: 0.7,
    unitLabel: "chunks",
    getTotalUnits: (estimates) => estimates.chunkCount,
  },
  {
    key: "vectorizing",
    label: "Creating vectors",
    start: 0.7,
    end: 0.94,
    unitLabel: "vectors",
    getTotalUnits: (estimates) => estimates.chunkCount,
  },
  {
    key: "indexing",
    label: "Saving index",
    start: 0.94,
    end: 1,
    unitLabel: "steps",
    getTotalUnits: () => 1,
  },
];

const MAX_SIMULATED_PROGRESS = 0.94;
const PROGRESS_TICK_MS = 180;

function estimatePageCount(fileSizeBytes: number): number {
  return Math.max(1, Math.min(250, Math.ceil(fileSizeBytes / (90 * 1024))));
}

function estimateChunkCount(fileSizeBytes: number): number {
  return Math.max(5, Math.min(500, Math.ceil(fileSizeBytes / 2200)));
}

function createUploadProgressState(
  fileName: string,
  fileIndex: number,
  totalFiles: number,
  progress: number,
  estimates: UploadEstimates,
): UploadProgressState {
  const normalizedProgress = Math.min(1, Math.max(0, progress));
  const activeStage =
    UPLOAD_PROGRESS_STAGES.find((stage) => normalizedProgress <= stage.end) ||
    UPLOAD_PROGRESS_STAGES[UPLOAD_PROGRESS_STAGES.length - 1];

  const stageSpan = Math.max(0.0001, activeStage.end - activeStage.start);
  const stageProgress = Math.min(
    1,
    Math.max(0, (normalizedProgress - activeStage.start) / stageSpan),
  );

  const totalUnits = Math.max(1, activeStage.getTotalUnits(estimates));
  let processedUnits = Math.floor(stageProgress * totalUnits);

  if (normalizedProgress > activeStage.start && processedUnits === 0) {
    processedUnits = 1;
  }

  if (normalizedProgress < activeStage.end && activeStage.key !== "indexing") {
    processedUnits = Math.min(processedUnits, Math.max(1, totalUnits - 1));
  }

  if (normalizedProgress >= 1) {
    processedUnits = totalUnits;
  }

  return {
    fileName,
    fileIndex,
    totalFiles,
    stage: activeStage.key,
    stageLabel: activeStage.label,
    stageIndex: UPLOAD_PROGRESS_STAGES.indexOf(activeStage) + 1,
    stageTotal: UPLOAD_PROGRESS_STAGES.length,
    processedUnits,
    totalUnits,
    unitLabel: activeStage.unitLabel,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function DocumentUploadSection({
  agentId,
  documents,
  onDocumentsChange,
  onPendingFilesChange,
  isNewAgent = false,
}: DocumentUploadSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] =
    useState<UploadProgressState | null>(null);

  // Pending files for new agents (not yet saved)
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const clearProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearProgressInterval = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const clearProgressTimeout = () => {
    if (clearProgressTimeoutRef.current) {
      clearTimeout(clearProgressTimeoutRef.current);
      clearProgressTimeoutRef.current = null;
    }
  };

  const startProgressSimulation = (
    file: File,
    fileIndex: number,
    totalFiles: number,
  ): UploadEstimates => {
    clearProgressInterval();
    clearProgressTimeout();

    const estimates: UploadEstimates = {
      pageCount: estimatePageCount(file.size),
      chunkCount: estimateChunkCount(file.size),
    };

    let progress = 0.03;
    setUploadProgress(
      createUploadProgressState(
        file.name,
        fileIndex,
        totalFiles,
        progress,
        estimates,
      ),
    );

    progressIntervalRef.current = setInterval(() => {
      progress = Math.min(
        MAX_SIMULATED_PROGRESS,
        progress + (MAX_SIMULATED_PROGRESS - progress) * 0.12,
      );

      setUploadProgress(
        createUploadProgressState(
          file.name,
          fileIndex,
          totalFiles,
          progress,
          estimates,
        ),
      );
    }, PROGRESS_TICK_MS);

    return estimates;
  };

  const completeProgressSimulation = (
    file: File,
    fileIndex: number,
    totalFiles: number,
    estimates: UploadEstimates,
  ) => {
    clearProgressInterval();

    setUploadProgress(
      createUploadProgressState(file.name, fileIndex, totalFiles, 1, estimates),
    );

    clearProgressTimeoutRef.current = setTimeout(() => {
      setUploadProgress(null);
      clearProgressTimeoutRef.current = null;
    }, 900);
  };

  const resetProgressSimulation = () => {
    clearProgressInterval();
    clearProgressTimeout();
    setUploadProgress(null);
  };

  useEffect(() => {
    return () => {
      clearProgressInterval();
      clearProgressTimeout();
    };
  }, []);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);

    const fileArray = Array.from(files);

    if (isNewAgent || !agentId) {
      // For new agents, store files locally until agent is saved
      const newPendingFiles = [...pendingFiles, ...fileArray];
      setPendingFiles(newPendingFiles);
      onPendingFilesChange?.(newPendingFiles);

      // Create temporary document objects for display
      const tempDocs: AgentDocument[] = fileArray.map((file) => ({
        id: `pending-${file.name}-${file.size}-${Date.now()}`,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        ref: "",
        uploadedAt: new Date().toISOString(),
      }));
      onDocumentsChange([...documents, ...tempDocs]);
      return;
    }

    setIsUploading(true);

    try {
      let updatedDocuments = [...documents];

      for (const [index, file] of fileArray.entries()) {
        const fileIndex = index + 1;
        const estimates = startProgressSimulation(
          file,
          fileIndex,
          fileArray.length,
        );

        const formData = new FormData();
        formData.append("file", file);
        formData.append("agentId", agentId);

        const response = await fetch("/api/agents/files", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          let errorMsg = `Upload failed (${response.status})`;
          try {
            const data = await response.json();
            if (data?.error) errorMsg = data.error;
          } catch {
            const text = await response.text().catch(() => "");
            if (text) errorMsg = text.slice(0, 200);
          }
          throw new Error(errorMsg);
        }

        const newDoc: AgentDocument = await response.json();
        updatedDocuments = [...updatedDocuments, newDoc];
        onDocumentsChange(updatedDocuments);

        completeProgressSimulation(
          file,
          fileIndex,
          fileArray.length,
          estimates,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload file";
      logger.error({ err: error }, `Upload error: ${message}`);
      resetProgressSimulation();
      setUploadError(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!agentId) {
      // For new agents, just remove from local state
      const docToDelete = documents.find((d) => d.id === documentId);
      onDocumentsChange(documents.filter((d) => d.id !== documentId));

      if (docToDelete) {
        const newPendingFiles = pendingFiles.filter(
          (f) =>
            f.name !== docToDelete.fileName || f.size !== docToDelete.fileSize,
        );
        setPendingFiles(newPendingFiles);
        onPendingFilesChange?.(newPendingFiles);
      }
      return;
    }

    setDeletingId(documentId);

    try {
      const response = await fetch("/api/agents/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, documentId }),
      });

      if (!response.ok) {
        let errorMsg = `Delete failed (${response.status})`;
        try {
          const data = await response.json();
          if (data?.error) errorMsg = data.error;
        } catch {
          const text = await response.text().catch(() => "");
          if (text) errorMsg = text.slice(0, 200);
        }
        throw new Error(errorMsg);
      }

      onDocumentsChange(documents.filter((d) => d.id !== documentId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete file";
      logger.error({ err: error }, `Delete error: ${message}`);
      setUploadError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-tertiary">
        Documents
      </label>
      <p className="text-xs text-tertiary/50">
        Upload documents for the agent to reference when responding.
      </p>

      {/* Upload Area */}
      <div
        className={cn(
          "relative border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-input-border hover:border-tertiary/40",
          isUploading && "pointer-events-none opacity-60",
        )}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={SUPPORTED_DOCUMENT_ACCEPT}
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        <div className="flex flex-col items-center gap-2 text-center">
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <span className="text-sm text-tertiary font-medium">
                  {uploadProgress
                    ? `${uploadProgress.stageLabel} (${uploadProgress.stageIndex}/${uploadProgress.stageTotal})`
                    : "Uploading..."}
                </span>

                {uploadProgress && (
                  <>
                    <span className="text-xs text-tertiary/60 max-w-[280px] truncate">
                      File {uploadProgress.fileIndex}/
                      {uploadProgress.totalFiles}: {uploadProgress.fileName}
                    </span>
                    <span className="text-xs text-primary font-semibold">
                      {uploadProgress.processedUnits}/
                      {uploadProgress.totalUnits} {uploadProgress.unitLabel}
                    </span>
                    <div className="h-1.5 w-56 rounded-full bg-input-bg overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                        style={{
                          width: `${Math.max(
                            4,
                            Math.round(
                              (uploadProgress.processedUnits /
                                uploadProgress.totalUnits) *
                                100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-tertiary/40" />
              <span className="text-sm text-tertiary">
                Drop files here or click to upload
              </span>
              <span className="text-xs text-tertiary/40">
                {SUPPORTED_DOCUMENT_FORMATS_LABEL}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Error Message */}
      {uploadError && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="flex-1 text-xs sm:text-sm font-medium leading-tight">{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="ml-auto p-1 rounded hover:bg-destructive/15 text-destructive/80 hover:text-destructive transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Document List */}
      {documents.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto rounded-lg border border-input-border bg-input-bg p-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 p-2 rounded-md bg-secondary/50 hover:bg-secondary transition-colors group"
            >
              <FileText className="h-5 w-5 text-tertiary/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-tertiary truncate">
                  {doc.fileName}
                </p>
                <div className="text-xs text-tertiary/40 flex items-center gap-1.5 flex-wrap">
                  <span>{formatFileSize(doc.fileSize)}</span>
                  {doc.id.startsWith("pending-") && (
                    <span className="text-amber-500 font-medium">
                      (will upload on save)
                    </span>
                  )}
                  {doc.status === "failed" && (
                    <span className="inline-flex items-center gap-1 text-destructive font-medium">
                      <AlertCircle className="h-3 w-3" />
                      {doc.error || "Indexing failed"}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(doc.id);
                }}
                disabled={deletingId === doc.id}
                className="p-1.5 rounded-md text-tertiary/40 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
              >
                {deletingId === doc.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add More Button */}
      {documents.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add More Documents
        </Button>
      )}
    </div>
  );
}

// Export pending files getter for use by parent component
export function getPendingFiles(): File[] {
  return [];
}
