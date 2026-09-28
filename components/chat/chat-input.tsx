"use client";

import { logger } from "@/lib/logger";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowUp,
  Mic,
  Book,
  X,
  Square,
  Loader2,
  FileText,
  Search,
  Globe,
  Image as ImageIcon,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { PromptLibraryModal } from "./prompt-library-modal";
import { ModelSelector } from "./model-selector";
import { AI_NAME } from "@/constants/main";
import { ChatAttachment } from "@/lib/types";
import { useDraftStore } from "@/lib/stores";
import { AttachmentMenu } from "./attachment-menu";
import { ToolsMenu } from "./tools-menu";
import type { DeepResearchDepth } from "@/lib/deep-research";
import type { ReasoningEffort } from "@/lib/types";
import { SUPPORTED_DOCUMENT_ACCEPT } from "@/lib/document-file-support";
import { MentionMenu, MentionItem } from "./mention-menu";
import { ReasoningMenu } from "./reasoning-menu";
import { useAgents } from "@/hooks/use-agents-queries";
import type { Agent } from "@/lib/types";

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
  activityId?: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (attachments: ChatAttachment[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  showModelSelector?: boolean;
  contextKey?: string;
  isDeepResearchEnabled?: boolean;
  onDeepResearchChange?: (enabled: boolean) => void;
  deepResearchDepth?: DeepResearchDepth;
  onDeepResearchDepthChange?: (depth: DeepResearchDepth) => void;
  isWebSearchEnabled?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  modelMenuAlignOffset?: number;
  shiftSubmenuLeftOnHome?: boolean;
  arenaSelector?: React.ReactNode;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  selectedAgent?: Agent | null;
  onAgentChange?: (agent: Agent | null) => void;
  selectedAgents?: Agent[];
  onAgentsChange?: (agents: Agent[]) => void;
}

interface PendingUpload {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  type: "document" | "image";
  previewUrl?: string;
}

function clearEditor(editor: HTMLDivElement) {
  while (editor.firstChild) {
    editor.removeChild(editor.firstChild);
  }
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  disabled,
  placeholder = `Message ${AI_NAME}`,
  selectedModel,
  onModelChange,
  showModelSelector = false,
  contextKey = "default",
  isDeepResearchEnabled,
  onDeepResearchChange,
  deepResearchDepth = "medium",
  onDeepResearchDepthChange,
  isWebSearchEnabled,
  onWebSearchChange,
  reasoningEffort = "off",
  onReasoningEffortChange,
  arenaSelector,
  selectedAgent,
  onAgentChange,
  selectedAgents,
  onAgentsChange,
}: ChatInputProps) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const savedSelectionRef = React.useRef<Range | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const {
    getDraft,
    addDraftAttachment,
    removeDraftAttachment,
    setDraftText,
    clearDraft,
  } = useDraftStore();
  const draft = getDraft(contextKey);
  const attachments = draft.attachments;

  // --- Editor helpers ---

  const getEditorText = React.useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return "";
    let text = "";
    editor.childNodes.forEach((node) => {
      text += node.textContent ?? "";
    });
    return text;
  }, []);

  // Insert inline agent mention span at saved cursor position
  const insertAgentMention = React.useCallback(
    (agentId: string, agentName: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const savedRange = savedSelectionRef.current;
      if (!savedRange) return;

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.cloneRange());

      const range = sel?.getRangeAt(0);
      if (!range) return;

      // Remove the @filter text the user typed
      const textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
        const atIndex = textNode.textContent.lastIndexOf(
          "@",
          range.startOffset - 1,
        );
        if (atIndex !== -1) {
          textNode.textContent =
            textNode.textContent.slice(0, atIndex) +
            textNode.textContent.slice(range.startOffset);
          range.setStart(textNode, atIndex);
          range.collapse(true);
        }
      }

      // Build mention span — styled via [data-mention] selector on parent
      const span = document.createElement("span");
      span.setAttribute("contenteditable", "false");
      span.setAttribute("data-mention", "true");
      span.dataset.agentId = agentId;
      span.textContent = `@${agentName}`;

      const space = document.createTextNode(" ");
      range.insertNode(space);
      range.insertNode(span);
      range.setStartAfter(space);
      range.collapse(true);
      sel?.removeAllRanges();
      if (range) sel?.addRange(range);

      onChange(getEditorText());
    },
    [getEditorText, onChange],
  );

  // Remove the @commandText typed for command mentions
  const removeTypedMention = React.useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const savedRange = savedSelectionRef.current;
    if (!savedRange) return;

    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange.cloneRange());

    const range = sel?.getRangeAt(0);
    if (!range) return;

    const textNode = range.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
      const atIndex = textNode.textContent.lastIndexOf(
        "@",
        range.startOffset - 1,
      );
      if (atIndex !== -1) {
        textNode.textContent =
          textNode.textContent.slice(0, atIndex) +
          textNode.textContent.slice(range.startOffset);
        range.setStart(textNode, atIndex);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
        onChange(getEditorText());
      }
    }
  }, [getEditorText, onChange]);

  // --- Placeholder state ---
  const [isEditorEmpty, setIsEditorEmpty] = React.useState(true);

  // --- Draft / value sync ---

  const hasLoadedDraft = React.useRef(false);
  React.useEffect(() => {
    if (hasLoadedDraft.current) return;
    hasLoadedDraft.current = true;
    if (draft.text && editorRef.current) {
      editorRef.current.textContent = draft.text;
      onChange(draft.text);
      setIsEditorEmpty(false);
    }
  }, [draft.text, onChange]);

  // Sync external value clears (e.g. after submit) and pre-fills (pending message)
  const lastExternalValue = React.useRef("");
  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (value === "" && editor.textContent !== "") {
      clearEditor(editor);
      setIsEditorEmpty(true);
    } else if (
      value !== "" &&
      value !== lastExternalValue.current &&
      editor.textContent === ""
    ) {
      editor.textContent = value;
      setIsEditorEmpty(false);
    }
    lastExternalValue.current = value;
  }, [value]);

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDraftText(contextKey, value);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [value, contextKey, setDraftText]);

  // --- Uploads ---

  const [pendingUploads, setPendingUploads] = React.useState<PendingUpload[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isListening, setIsListening] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const pendingPreviewUrlsRef = React.useRef<Map<string, string>>(new Map());
  const isUploading = pendingUploads.length > 0;

  const getUploadSignature = React.useCallback(
    (
      fileName: string,
      fileSize: number,
      mimeType: string,
      type: "document" | "image",
    ) =>
      `${type}:${fileName.trim().toLowerCase()}:${fileSize}:${mimeType.toLowerCase()}`,
    [],
  );

  const getExistingUploadSignatures = React.useCallback(() => {
    const signatures = new Set<string>();

    for (const attachment of attachments ?? []) {
      signatures.add(
        getUploadSignature(
          attachment.fileName,
          attachment.fileSize,
          attachment.mimeType,
          attachment.type,
        ),
      );
    }

    for (const pending of pendingUploads) {
      signatures.add(
        getUploadSignature(
          pending.fileName,
          pending.fileSize,
          pending.mimeType,
          pending.type,
        ),
      );
    }

    return signatures;
  }, [attachments, pendingUploads, getUploadSignature]);

  const formatDuplicateUploadMessage = React.useCallback(
    (duplicates: string[]) => {
      const uniqueNames = Array.from(new Set(duplicates));
      const preview = uniqueNames.slice(0, 3).join(", ");
      const remaining = uniqueNames.length - 3;

      if (remaining > 0) {
        return `Skipped duplicate files: ${preview} (+${remaining} more)`;
      }

      return `Skipped duplicate files: ${preview}`;
    },
    [],
  );

  // --- Mention state ---

  const [mentionState, setMentionState] = React.useState<{
    isOpen: boolean;
    filter: string;
    cursorPosition: number;
  }>({
    isOpen: false,
    filter: "",
    cursorPosition: 0,
  });

  const mentionMenuRef =
    React.useRef<import("./mention-menu").MentionMenuRef>(null);

  const { data: agents = [] } = useAgents();

  const COMMANDS: MentionItem[] = React.useMemo(
    () => [
      {
        id: "research",
        label: "Deep Research",
        description: "Toggle deep research mode",
        icon: <Search className="h-3.5 w-3.5" />,
        category: "commands",
      },
      {
        id: "web",
        label: "Web Search",
        description: "Toggle web search",
        icon: <Globe className="h-3.5 w-3.5" />,
        category: "commands",
      },
      {
        id: "prompts",
        label: "Prompt Library",
        description: "Open prompt library",
        icon: <Book className="h-3.5 w-3.5" />,
        category: "commands",
      },
      {
        id: "file",
        label: "Upload File",
        description: "Upload a document from your computer",
        icon: <FileText className="h-3.5 w-3.5" />,
        category: "commands",
      },
      {
        id: "image",
        label: "Upload Image",
        description: "Upload an image from your computer",
        icon: <ImageIcon className="h-3.5 w-3.5" />,
        category: "commands",
      },
    ],
    [],
  );

  const filteredItems = React.useMemo(() => {
    if (!mentionState.isOpen) return [];

    const filterText = mentionState.filter.toLowerCase();

    const isMultiSelectMode = Boolean(onAgentsChange);
    const alreadySelectedIds = new Set(selectedAgents?.map((a) => a.id) || []);

    const agentItems: MentionItem[] =
      !isMultiSelectMode && selectedAgent
        ? []
        : agents
            .filter(
              (agent) =>
                agent.name.toLowerCase().includes(filterText) &&
                (!isMultiSelectMode || !alreadySelectedIds.has(agent.id)),
            )
            .map((agent) => ({
              id: agent.id,
              label: agent.name,
              description: agent.description,
              icon: <Bot className="h-3.5 w-3.5" />,
              category: "agents" as const,
              data: agent,
            }));

    const cmdItems = COMMANDS.filter(
      (item) =>
        item.label.toLowerCase().includes(filterText) ||
        item.id.toLowerCase().includes(filterText),
    );

    return [...agentItems, ...cmdItems];
  }, [
    mentionState.isOpen,
    mentionState.filter,
    agents,
    COMMANDS,
    selectedAgent,
    selectedAgents,
    onAgentsChange,
  ]);

  const handleMentionSelect = (item: MentionItem) => {
    setMentionState((prev) => ({ ...prev, isOpen: false }));

    if (item.category === "agents") {
      const agent = item.data as Agent;
      insertAgentMention(agent.id, agent.name);
      if (onAgentsChange && selectedAgents) {
        onAgentsChange([...selectedAgents, agent]);
      } else {
        onAgentChange?.(agent);
        if (agent?.modelId && onModelChange) {
          onModelChange(agent.modelId);
        }
      }
    } else if (item.category === "commands") {
      removeTypedMention();
      switch (item.id) {
        case "research":
          onDeepResearchChange?.(!isDeepResearchEnabled);
          break;
        case "web":
          onWebSearchChange?.(!isWebSearchEnabled);
          break;
        case "prompts":
          openPromptLibrary();
          break;
        case "file":
          fileInputRef.current?.click();
          break;
        case "image":
          imageInputRef.current?.click();
          break;
      }
    }

    editorRef.current?.focus();
  };

  // --- Speech recognition ---

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognitionAPI =
        (
          window as unknown as {
            SpeechRecognition?: new () => SpeechRecognition;
            webkitSpeechRecognition?: new () => SpeechRecognition;
          }
        ).SpeechRecognition ||
        (
          window as unknown as {
            webkitSpeechRecognition?: new () => SpeechRecognition;
          }
        ).webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognitionRef.current = recognition;
      }
    }
  }, []);

  const valueRef = React.useRef(value);
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  React.useEffect(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          const currentValue = valueRef.current;
          const appendText =
            (currentValue && !currentValue.endsWith(" ") ? " " : "") +
            finalTranscript;
          if (editorRef.current) {
            editorRef.current.appendChild(document.createTextNode(appendText));
            const newText = getEditorText();
            onChange(newText);
            setIsEditorEmpty(newText === "");
          } else {
            onChange(currentValue + appendText);
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        logger.error({ error: event.error }, "Speech recognition error");
        let message = "Speech recognition error";
        switch (event.error) {
          case "network":
            message = "Network connection error during speech recognition.";
            break;
          case "not-allowed":
          case "service-not-allowed":
            message =
              "Microphone access denied. Please check your permissions.";
            break;
          case "no-speech":
            message = "No speech detected. Please try again.";
            break;
          case "aborted":
            message = "Speech recognition aborted.";
            break;
          default:
            message = `Speech recognition error: ${event.error}`;
        }
        setErrorMessage(message);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };
    }
  }, [onChange, getEditorText]);

  const handleToggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setErrorMessage(null);
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const removePendingUpload = React.useCallback((pendingId: string) => {
    setPendingUploads((prev) =>
      prev.filter((upload) => upload.id !== pendingId),
    );

    const previewUrl = pendingPreviewUrlsRef.current.get(pendingId);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      pendingPreviewUrlsRef.current.delete(pendingId);
    }
  }, []);

  const uploadFileWithPending = React.useCallback(
    async (file: File, type: "document" | "image") => {
      const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl =
        type === "image" ? URL.createObjectURL(file) : undefined;
      if (previewUrl) {
        pendingPreviewUrlsRef.current.set(pendingId, previewUrl);
      }

      setPendingUploads((prev) => [
        ...prev,
        {
          id: pendingId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          type,
          previewUrl,
        },
      ]);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/chat/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to upload ${file.name}`);
        }

        const attachment: ChatAttachment = await response.json();
        addDraftAttachment(contextKey, attachment);
      } catch (error) {
        logger.error({ error }, "File upload error");
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to upload file",
        );
      } finally {
        removePendingUpload(pendingId);
      }
    },
    [addDraftAttachment, contextKey, removePendingUpload],
  );

  React.useEffect(
    () => () => {
      pendingPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      pendingPreviewUrlsRef.current.clear();
    },
    [],
  );

  const handleFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setErrorMessage(null);

    try {
      const seenSignatures = getExistingUploadSignatures();
      const filesToUpload: File[] = [];
      const duplicates: string[] = [];

      for (const file of files) {
        const signature = getUploadSignature(
          file.name,
          file.size,
          file.type,
          "document",
        );

        if (seenSignatures.has(signature)) {
          duplicates.push(file.name);
          continue;
        }

        seenSignatures.add(signature);
        filesToUpload.push(file);
      }

      if (duplicates.length > 0) {
        setErrorMessage(formatDuplicateUploadMessage(duplicates));
      }

      if (filesToUpload.length === 0) return;

      await Promise.all(
        filesToUpload.map((file) => uploadFileWithPending(file, "document")),
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImagesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setErrorMessage(null);

    try {
      const seenSignatures = getExistingUploadSignatures();
      const filesToUpload: File[] = [];
      const duplicates: string[] = [];

      for (const file of files) {
        const signature = getUploadSignature(
          file.name,
          file.size,
          file.type,
          "image",
        );

        if (seenSignatures.has(signature)) {
          duplicates.push(file.name);
          continue;
        }

        seenSignatures.add(signature);
        filesToUpload.push(file);
      }

      if (duplicates.length > 0) {
        setErrorMessage(formatDuplicateUploadMessage(duplicates));
      }

      if (filesToUpload.length === 0) return;

      await Promise.all(
        filesToUpload.map((file) => uploadFileWithPending(file, "image")),
      );
    } finally {
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  };

  const handleRemoveAttachment = React.useCallback(
    (attachment: ChatAttachment) => {
      removeDraftAttachment(contextKey, attachment.id);
      setErrorMessage(null);

      if (attachment.ref) {
        const params = new URLSearchParams({ ref: attachment.ref });
        fetch(`/api/chat/upload/${attachment.id}?${params}`, {
          method: "DELETE",
        }).catch((error) => {
          logger.error({ error }, "Failed to delete attachment from storage");
        });
      }
    },
    [contextKey, removeDraftAttachment],
  );

  const handleSubmit = () => {
    if (isUploading) return;
    onSubmit(activeAttachments);

    clearDraft(contextKey);
    onChange("");
    if (editorRef.current) {
      clearEditor(editorRef.current);
    }
    setIsEditorEmpty(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }

    setErrorMessage(null);
  };

  const [isPromptLibraryOpen, setIsPromptLibraryOpen] = React.useState(false);
  const promptLibraryBtnRef = React.useRef<HTMLButtonElement>(null);
  const [promptLibraryOrigin, setPromptLibraryOrigin] = React.useState<{
    x: number;
    y: number;
  } | null>(null);

  const openPromptLibrary = React.useCallback(() => {
    if (promptLibraryBtnRef.current) {
      const rect = promptLibraryBtnRef.current.getBoundingClientRect();
      setPromptLibraryOrigin({
        x: rect.left + rect.width / 2 - window.innerWidth / 2,
        y: rect.top + rect.height / 2 - window.innerHeight / 2,
      });
    }
    setIsPromptLibraryOpen(true);
  }, []);

  const handlePromptSelect = (content: string) => {
    const editor = editorRef.current;
    if (editor) {
      const currentText = editor.textContent ?? "";
      const appendText = currentText ? `\n${content}` : content;
      editor.appendChild(document.createTextNode(appendText));
      const newText = getEditorText();
      onChange(newText);
      setIsEditorEmpty(newText === "");
    } else {
      const newValue = value ? `${value}\n${content}` : content;
      onChange(newValue);
    }
    setIsPromptLibraryOpen(false);
    setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        setErrorMessage(null);
        const seenSignatures = getExistingUploadSignatures();
        const signature = getUploadSignature(
          file.name,
          file.size,
          file.type,
          "image",
        );

        if (seenSignatures.has(signature)) {
          setErrorMessage(formatDuplicateUploadMessage([file.name]));
          break;
        }

        await uploadFileWithPending(file, "image");
        return;
      }
    }

    // Strip HTML on paste — insert plain text only to prevent XSS
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        const newText = getEditorText();
        onChange(newText);
        setIsEditorEmpty(newText === "");
      }
    }
  };

  const renderAttachments = attachments;
  const activeAttachments = attachments;
  const hasAttachmentRail =
    renderAttachments.length > 0 || pendingUploads.length > 0;
  const showResearchDepthSelector =
    !!isDeepResearchEnabled && !!onDeepResearchDepthChange;
  const depthOptions: { value: DeepResearchDepth; label: string }[] = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "very_high", label: "Very High" },
  ];

  return (
    <div className="relative w-full max-w-3xl mx-auto">
      <motion.div
        className={cn(
          "relative flex flex-col rounded-[1.75rem] bg-chat-surface backdrop-blur-xl",
          "shadow-[0_2px_20px_-4px_rgba(0,0,0,0.06),0_1px_4px_-1px_rgba(0,0,0,0.04)]",
          "dark:shadow-[0_2px_20px_-4px_rgba(0,0,0,0.15),0_1px_4px_-1px_rgba(0,0,0,0.1)]",
          "border border-tertiary/[0.08] dark:border-white/6",
          "transition-shadow duration-200 focus-within:shadow-[0_4px_28px_-4px_rgba(0,0,0,0.08),0_1px_4px_-1px_rgba(0,0,0,0.04)]",
          "dark:focus-within:shadow-[0_4px_28px_-4px_rgba(0,0,0,0.2)]",
          "focus-within:outline-none focus-within:ring-0",
        )}
      >
        {/* Error Message */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              key="error"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="px-3 sm:px-4 pt-3 pb-0">
                <div className="flex items-center gap-2 bg-red-500/10 rounded-lg p-2 w-fit">
                  <X className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-500">{errorMessage}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 cursor-pointer text-red-500 hover:text-red-400"
                    onClick={() => setErrorMessage(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attachments Grid */}
        <AnimatePresence initial={false}>
          {hasAttachmentRail && (
            <motion.div
              key="attachment-rail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="px-3 sm:px-4 pt-3 pb-0">
                <div className="flex gap-2 overflow-x-auto overflow-y-hidden pt-1 pb-1 pr-0.5 [scrollbar-width:thin]">
                  <AnimatePresence mode="popLayout">
                    {renderAttachments.map((attachment) => {
                      return attachment.type === "image" ? (
                        <motion.div
                          key={`attachment-${attachment.id}`}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.15 }}
                          className="relative shrink-0"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.fileName}
                            className="h-20 w-20 object-cover rounded-lg border border-tertiary/10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-5 w-5 cursor-pointer rounded-full bg-secondary/80 text-foreground border border-tertiary/15 hover:bg-secondary shadow-sm [&_svg]:size-2.5 p-0"
                            onClick={() => handleRemoveAttachment(attachment)}
                          >
                            <X className="h-2.5 w-2.5" />
                          </Button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={`attachment-${attachment.id}`}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.15 }}
                          className="shrink-0 flex items-center gap-2 bg-tertiary/5 rounded-lg p-2 border border-tertiary/10"
                        >
                          <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center shrink-0 text-tertiary/70">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col min-w-0 max-w-[150px]">
                            <span className="text-sm font-medium truncate text-tertiary">
                              {attachment.fileName}
                            </span>
                            <span className="text-xs text-tertiary/50">
                              Document
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 ml-1 cursor-pointer text-tertiary/50 hover:text-tertiary"
                            onClick={() => handleRemoveAttachment(attachment)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </motion.div>
                      );
                    })}

                    {pendingUploads.map((upload) =>
                      upload.type === "image" ? (
                        <motion.div
                          key={`pending-${upload.id}`}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 0.7, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.15 }}
                          className="relative shrink-0"
                        >
                          {upload.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={upload.previewUrl}
                              alt={upload.fileName}
                              className="h-20 w-20 object-cover rounded-lg border border-tertiary/10"
                            />
                          ) : (
                            <div className="h-20 w-20 rounded-lg border border-tertiary/10 bg-tertiary/5" />
                          )}
                          <div className="absolute inset-0 rounded-lg bg-black/10 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={`pending-${upload.id}`}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.15 }}
                          className="shrink-0 flex items-center gap-2 rounded-lg p-2 border border-dashed border-primary/35 bg-primary/5"
                        >
                          <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center shrink-0 text-tertiary/70">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col min-w-0 max-w-[150px]">
                            <span className="text-sm font-medium truncate text-tertiary">
                              {upload.fileName}
                            </span>
                            <span className="text-xs text-tertiary/50">
                              Uploading...
                            </span>
                          </div>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        </motion.div>
                      ),
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className="flex items-end px-3 sm:px-4 pt-4 pb-2"
          ref={containerRef}
        >
          <MentionMenu
            ref={mentionMenuRef}
            items={filteredItems}
            onSelect={handleMentionSelect}
            anchorRef={containerRef}
          />
          {/* Rich-text editor with inline @mention highlighting */}
          <div className="relative flex-1 min-w-0">
            {isEditorEmpty && (
              <div
                className="absolute left-0 top-0 text-sm leading-5 text-tertiary/50 pointer-events-none select-none"
                aria-hidden
              >
                {placeholder}
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable={!disabled}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              onInput={() => {
                const editor = editorRef.current;
                if (!editor) return;

                // Remove stray <br> browsers insert when clearing
                if (
                  editor.childNodes.length === 1 &&
                  editor.childNodes[0].nodeName === "BR"
                ) {
                  clearEditor(editor);
                }

                const text = getEditorText();
                onChange(text);
                setIsEditorEmpty(text === "");

                // Sync selectedAgents to DOM spans (handles span deletion)
                if (onAgentsChange && editorRef.current) {
                  const spans = editorRef.current.querySelectorAll("[data-mention]");
                  const currentAgentIds = new Set(
                    Array.from(spans).map((s) => (s as HTMLElement).dataset.agentId),
                  );
                  const syncedAgents = agents.filter((a) => currentAgentIds.has(a.id));
                  const prevIds = new Set(selectedAgents?.map((a) => a.id) ?? []);
                  const changed =
                    syncedAgents.length !== prevIds.size ||
                    syncedAgents.some((a) => !prevIds.has(a.id));
                  if (changed) onAgentsChange(syncedAgents);
                }

                // Detect @mention trigger
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) {
                  setMentionState((prev) => ({ ...prev, isOpen: false }));
                  return;
                }
                const range = sel.getRangeAt(0);
                const nodeText = range.startContainer.textContent ?? "";
                const textBeforeCursor = nodeText.slice(0, range.startOffset);
                const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
                if (mentionMatch) {
                  savedSelectionRef.current = range.cloneRange();
                  setMentionState({
                    isOpen: true,
                    filter: mentionMatch[1],
                    cursorPosition: range.startOffset,
                  });
                } else {
                  setMentionState((prev) => ({ ...prev, isOpen: false }));
                }
              }}
              onKeyDown={(e) => {
                if (mentionState.isOpen && mentionMenuRef.current) {
                  if (e.key === "Escape") {
                    setMentionState((prev) => ({ ...prev, isOpen: false }));
                    return;
                  }
                  const handled = mentionMenuRef.current.handleKeyDown(e);
                  if (handled) return;
                }

                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (
                    !isLoading &&
                    !isUploading &&
                    (value.trim() || activeAttachments.length > 0)
                  ) {
                    handleSubmit();
                  }
                }
              }}
              onPaste={handlePaste}
              onBlur={() => {
                // Save selection so insertAgentMention can restore it after menu click
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
                }
                setTimeout(() => {
                  setMentionState((prev) => ({ ...prev, isOpen: false }));
                }, 200);
              }}
              className={cn(
                "w-full border-0 bg-transparent p-0 outline-none",
                "text-tertiary text-left",
                "min-h-[50px] max-h-[200px] overflow-y-auto",
                "text-sm leading-5 wrap-break-word whitespace-pre-wrap",
                // Inline mention span styling via data-mention attribute
                "**:data-mention:text-primary",
                "**:data-mention:bg-primary/10",
                "**:data-mention:rounded",
                "**:data-mention:px-1",
                "**:data-mention:py-0.5",
                "**:data-mention:font-medium",
                "**:data-mention:cursor-default",
                "**:data-mention:select-none",
                disabled && "opacity-50 pointer-events-none",
              )}
            />
          </div>
        </div>

        {/* Bottom Action Bar */}
        <AnimatePresence>
          {showResearchDepthSelector && (
            <motion.div
              key="depth-selector"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="flex items-center flex-wrap gap-2 px-3 sm:px-4 pb-2">
                <span className="text-xs text-tertiary/60">Research depth:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {depthOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || isLoading}
                      onClick={() => onDeepResearchDepthChange(option.value)}
                      className={cn(
                        "h-7 rounded-full px-3 text-xs border transition-colors cursor-pointer",
                        deepResearchDepth === option.value
                          ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                          : "text-tertiary/70 border-tertiary/20 hover:bg-tertiary/5 hover:text-tertiary",
                      )}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between gap-1 px-3 sm:px-4 pb-2 flex-wrap">
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFilesSelect}
            accept={SUPPORTED_DOCUMENT_ACCEPT}
            multiple
          />
          {/* Hidden Image Input */}
          <input
            type="file"
            ref={imageInputRef}
            className="hidden"
            onChange={handleImagesSelect}
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
          />

          {/* Left Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <AttachmentMenu
              onFileClick={() => fileInputRef.current?.click()}
              onImageClick={() => imageInputRef.current?.click()}
              disabled={disabled || isLoading}
            />
            {(onWebSearchChange || onDeepResearchChange) && (
              <ToolsMenu
                isWebSearchEnabled={isWebSearchEnabled}
                onWebSearchChange={onWebSearchChange}
                isDeepResearchEnabled={isDeepResearchEnabled}
                onDeepResearchChange={onDeepResearchChange}
                disabled={disabled || isLoading}
              />
            )}
            <PromptLibraryModal
              open={isPromptLibraryOpen}
              onOpenChange={setIsPromptLibraryOpen}
              onSelect={handlePromptSelect}
              animationOrigin={promptLibraryOrigin}
            />
            <Button
              ref={promptLibraryBtnRef}
              type="button"
              variant="ghost"
              size="icon"
              onClick={openPromptLibrary}
              className="h-7 w-7 rounded-lg cursor-pointer text-tertiary/50 hover:text-tertiary hover:bg-tertiary/5"
              disabled={disabled || isLoading}
              title="Prompt Library"
            >
              <Book className="h-4 w-4" />
            </Button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {arenaSelector}
            {showModelSelector && selectedModel && onModelChange && !selectedAgent && !selectedAgents?.length && (
              <ModelSelector
                value={selectedModel}
                onChange={onModelChange}
                disabled={disabled || isLoading}
                triggerClassName="mr-1"
              />
            )}
            {onReasoningEffortChange && !selectedAgent && !selectedAgents?.length && (
              <ReasoningMenu
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={onReasoningEffortChange}
                disabled={disabled || isLoading}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 shrink-0 rounded-full transition-all duration-200 cursor-pointer",
                isListening
                  ? "text-primary bg-primary/12 shadow-sm shadow-primary/10 hover:bg-primary/18"
                  : "text-tertiary/45 hover:text-tertiary hover:bg-tertiary/8",
              )}
              disabled={disabled || isLoading}
              onClick={handleToggleListening}
            >
              <Mic className={cn("h-4 w-4", isListening && "animate-pulse")} />
            </Button>
            {isLoading ? (
              <Button
                type="button"
                size="icon"
                onClick={onStop}
                className={cn(
                  "h-8 w-8 shrink-0 rounded-full cursor-pointer",
                  "bg-tertiary text-secondary hover:bg-tertiary/90 shadow-sm transition-all duration-200",
                )}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={() => handleSubmit()}
                disabled={
                  (!value.trim() && activeAttachments.length === 0) ||
                  disabled ||
                  isUploading
                }
                className={cn(
                  "h-8 w-8 rounded-full transition-all duration-200 cursor-pointer shadow-none",
                  (value.trim() || activeAttachments.length > 0) && !isUploading
                    ? "bg-primary text-background hover:scale-105 active:scale-95"
                    : "bg-tertiary/5 text-tertiary/20",
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
