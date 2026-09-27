"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Image as ImageIcon, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

interface AttachmentMenuProps {
  onFileClick: () => void;
  onImageClick: () => void;
  disabled?: boolean;
}

export function AttachmentMenu({
  onFileClick,
  onImageClick,
  disabled = false,
}: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleItemClick = (callback: () => void) => {
    callback();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full cursor-pointer text-tertiary/50 hover:text-tertiary hover:bg-tertiary/5 transition-colors"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        title="Add attachments"
      >
        <Plus className="h-5 w-5" />
      </Button>

      {isOpen && (
        <div
          className={cn(
            "absolute bottom-full left-0 mb-2 z-50",
            "bg-dropdown-bg rounded-2xl shadow-lg",
            "border border-tertiary/8",
            "py-1.5 min-w-[190px]",
            "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
          )}
        >
          <button
            onClick={() => handleItemClick(onImageClick)}
            className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-tertiary/5 transition-colors text-left"
          >
            <ImageIcon className="h-5 w-5 text-tertiary/70" />
            <span className="text-sm text-tertiary">Images</span>
          </button>

          <button
            onClick={() => handleItemClick(onFileClick)}
            className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-tertiary/5 transition-colors text-left"
          >
            <Paperclip className="h-5 w-5 text-tertiary/70" />
            <span className="text-sm text-tertiary">Documents</span>
          </button>
        </div>
      )}
    </div>
  );
}
