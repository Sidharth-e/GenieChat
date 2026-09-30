import { ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  onSubmit?: () => void;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  submitClassName?: string;
  cancelClassName?: string;
  footerClassName?: string;
  bodyClassName?: string;
  maxWidthClassName?: string;
}

export function FormDialog({
  isOpen,
  onClose,
  title,
  children,
  onSubmit,
  isSubmitting = false,
  submitDisabled = false,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  submitClassName = "px-4 h-9 bg-primary text-primary-foreground hover:bg-primary/90",
  cancelClassName = "px-4 h-9 text-tertiary hover:text-tertiary hover:bg-tertiary/10",
  footerClassName,
  bodyClassName = "space-y-5",
  maxWidthClassName = "sm:max-w-[640px]",
}: FormDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90vh] p-0 gap-0 border border-modal-border/40 bg-modal-bg text-foreground overflow-hidden rounded-xl shadow-2xl flex flex-col",
          maxWidthClassName
        )}
      >
        <DialogHeader className="px-6 py-4 border-b border-tertiary/10 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold text-tertiary">
              {title}
            </DialogTitle>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-tertiary/60 hover:text-tertiary hover:bg-tertiary/10 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className={cn("flex-1 overflow-y-auto px-6 py-5", bodyClassName)}>
          {children}
        </div>

        <div
          className={cn(
            "px-6 py-4 border-t border-tertiary/10 flex items-center justify-end gap-3 shrink-0",
            footerClassName
          )}
        >
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className={cn(
              "rounded-lg font-medium transition-all",
              cancelClassName
            )}
          >
            {cancelLabel}
          </Button>
          {onSubmit && (
            <Button
              onClick={onSubmit}
              disabled={isSubmitting || submitDisabled}
              className={cn(
                "rounded-lg font-medium transition-all",
                submitClassName,
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
