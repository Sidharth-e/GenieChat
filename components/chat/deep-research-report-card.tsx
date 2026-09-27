"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { FileSearch, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { DeepResearchReportModal } from "./deep-research-report-modal";

interface DeepResearchReportCardProps {
  title: string;
  createdAt: string;
  reportRef: string;
  reportId?: string;
}

export function DeepResearchReportCard({
  title,
  createdAt,
  reportRef,
}: DeepResearchReportCardProps) {
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  const formattedDate = React.useMemo(() => {
    try {
      return format(new Date(createdAt), "MMM d, h:mm a");
    } catch {
      return createdAt;
    }
  }, [createdAt]);

  return (
    <>
      <div
        className="group flex items-center gap-3 p-4 rounded-xl bg-linear-to-r from-primary/5 to-secondary/50 border border-primary/20 hover:border-primary/40 max-w-md mt-3 mb-4 transition-all duration-200 cursor-pointer"
        onClick={() => setIsModalOpen(true)}
      >
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 text-primary shrink-0 group-hover:bg-primary/15 transition-colors">
          <FileSearch className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-tertiary truncate group-hover:text-primary transition-colors">
            {title}
          </p>
          <p className="text-xs text-tertiary/60 mt-0.5">
            Research Report • {formattedDate}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-tertiary/60 hover:text-primary group-hover:text-primary/80"
          onClick={(e) => {
            e.stopPropagation();
            setIsModalOpen(true);
          }}
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          View
        </Button>
      </div>

      <DeepResearchReportModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        title={title}
        reportRef={reportRef}
      />
    </>
  );
}
