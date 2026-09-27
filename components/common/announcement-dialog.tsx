"use client";

import * as React from "react";
import { type Announcement } from "@/constants/announcements";
import { useAuthStore } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function AnnouncementDialog() {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const [announcement, setAnnouncement] = React.useState<Announcement | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isLoading || !isAuthenticated || !user) {
      return;
    }

    let isActive = true;

    const loadAnnouncement = async () => {
      try {
        setError(null);
        const response = await fetch("/api/announcements", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          setAnnouncement(null);
          return;
        }

        const nextAnnouncement = (await response.json()) as Announcement | null;
        if (isActive) {
          setAnnouncement(nextAnnouncement);
        }
      } catch {
        if (isActive) {
          setAnnouncement(null);
        }
      }
    };

    void loadAnnouncement();

    return () => {
      isActive = false;
    };
  }, [isAuthenticated, isLoading, user]);

  const handleDismiss = React.useCallback(async () => {
    if (!user || !announcement || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ announcementId: announcement.id }),
      });

      if (!response.ok) {
        setError("Failed to save announcement status. Please try again.");
        return;
      }

      setAnnouncement(null);
    } catch {
      setError("Failed to save announcement status. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [announcement, isSaving, user]);

  return (
    <Dialog
      open={Boolean(announcement)}
      onOpenChange={(open) => {
        if (!open) {
          void handleDismiss();
        }
      }}
    >
      <DialogContent className="max-w-lg border border-modal-border/40 bg-modal-bg backdrop-blur-xl">
        <DialogHeader className="text-left">
          <DialogTitle>{announcement?.title}</DialogTitle>
          <DialogDescription>{announcement?.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-6 text-foreground/85">
          {announcement?.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <DialogFooter>
          <Button onClick={() => void handleDismiss()} disabled={isSaving}>
            {isSaving ? "Saving..." : (announcement?.ctaLabel ?? "Got it")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
