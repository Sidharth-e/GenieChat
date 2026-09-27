"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function NewChatDialog({
  open,
  onOpenChange,
  onConfirm,
}: NewChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Start a new chat?</DialogTitle>
          </div>
          <DialogDescription className="text-tertiary pt-2">
            Selecting this tool will start a new chat. You can return to this
            conversation at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex-row gap-2 sm:gap-2">
          {/* "Don't ask me again" toggle could be added here in future if needed */}
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-tertiary hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className="bg-primary hover:bg-primary/90 text-background rounded-full px-6"
          >
            New chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
