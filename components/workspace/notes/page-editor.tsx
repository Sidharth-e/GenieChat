"use client";

import * as React from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Block, BlockNoteEditor } from "@blocknote/core";
import { useTheme } from "next-themes";

export interface EditablePage {
  id: string;
  title: string;
  content: string;
}

export interface PageEditorProps {
  page: EditablePage;
  onUpdate: (updates: Partial<EditablePage>) => void;
}

function useBlockNoteTheme(): "light" | "dark" {
  const { resolvedTheme } = useTheme();
  const [bnTheme, setBnTheme] = React.useState<"light" | "dark">("dark");

  React.useEffect(() => {
    const isDark =
      resolvedTheme === "dark" ||
      document.documentElement.classList.contains("dark") ||
      document.documentElement.getAttribute("data-theme") === "dark";
    setBnTheme(isDark ? "dark" : "light");
  }, [resolvedTheme]);

  return bnTheme;
}

async function htmlToBlocks(
  editor: BlockNoteEditor,
  html: string,
): Promise<Block[]> {
  if (!html || html === "<p></p>") return [];
  try {
    return await editor.tryParseHTMLToBlocks(html);
  } catch {
    return [];
  }
}

function isWhitespaceHtml(value: string): boolean {
  return (
    value
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim() === ""
  );
}

export function PageEditor({ page, onUpdate }: PageEditorProps) {
  const [title, setTitle] = React.useState(page.title);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const saveTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingUpdatesRef = React.useRef<Partial<EditablePage>>({});
  const initializedRef = React.useRef(false);
  const currentPageIdRef = React.useRef(page.id);
  const theme = useBlockNoteTheme();

  const editor = useCreateBlockNote();

  React.useEffect(() => {
    if (!editor) return;

    if (currentPageIdRef.current !== page.id) {
      initializedRef.current = false;
      currentPageIdRef.current = page.id;
    }

    if (initializedRef.current) return;
    initializedRef.current = true;

    setTitle(page.title);
    pendingUpdatesRef.current = {};

    const html = page.content || "<p></p>";
    htmlToBlocks(editor, html).then((blocks) => {
      if (blocks.length > 0) {
        editor.replaceBlocks(editor.document, blocks);
      }
    });
  }, [editor, page.id, page.title, page.content]);

  const scheduleSave = React.useCallback(
    (updates: Partial<EditablePage>) => {
      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        const pending = pendingUpdatesRef.current;
        pendingUpdatesRef.current = {};
        onUpdate(pending);
      }, 800);
    },
    [onUpdate],
  );

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    scheduleSave({ title: val });
  };

  const handleEditorChange = React.useCallback(() => {
    if (!editor || !initializedRef.current) return;

    (async () => {
      const html = await editor.blocksToHTMLLossy(editor.document);
      const normalized = isWhitespaceHtml(html) ? "<p></p>" : html;
      scheduleSave({ content: normalized });
    })();
  }, [editor, scheduleSave]);

  return (
    <div className="flex h-full flex-col">
      <div className="pl-[3.5rem] pr-6 pt-6 pb-2">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled"
          className="w-full text-xl font-semibold bg-transparent border-none appearance-none shadow-none focus:shadow-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 text-foreground [box-shadow:none!important]"
        />
      </div>

      <div className="flex-1 overflow-y-auto bn-container-wrapper">
        <BlockNoteView
          editor={editor}
          theme={theme}
          onChange={handleEditorChange}
        />
      </div>
    </div>
  );
}
