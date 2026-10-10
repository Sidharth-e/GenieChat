"use client";

import * as React from "react";

import { parseVideoFence } from "@/lib/video";

const HEADER_LABEL =
  "text-[10px] font-semibold uppercase tracking-wider text-text-secondary";

const HEADER_ACTION =
  "text-[11px] font-medium text-primary hover:text-primary/80 transition-colors";

interface VideoBlockProps {
  content: string;
  isStreaming?: boolean;
}

/**
 * Renders a ```` ```video ```` fence as a playable clip.
 *
 * A fence rather than an image's `![]()`, because markdown has no video syntax.
 * The body is a JSON reference the tool wrote; like the scan-code renderer, an
 * unparseable body means two different things depending on whether the reply has
 * finished arriving — mid-stream it is still coming, so a skeleton is honest,
 * but afterwards it is malformed and saying so beats a skeleton that never
 * resolves.
 *
 * The source is the storage download proxy, not a presigned URL: the reply is
 * read long after any one signature would have expired, and the proxy presigns
 * afresh on every request.
 */
export function VideoBlock({ content, isStreaming }: VideoBlockProps) {
  const fence = React.useMemo(() => parseVideoFence(content), [content]);

  if (!fence) {
    return isStreaming ? <VideoSkeleton /> : <VideoError />;
  }

  return (
    <div className="my-6 overflow-hidden rounded-xl border border-card-border bg-card-bg">
      <div className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-2">
        <span className={HEADER_LABEL}>Video</span>
        <a
          href={fence.url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={HEADER_ACTION}
        >
          Download
        </a>
      </div>

      <div className="flex justify-center bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={fence.url}
          controls
          preload="metadata"
          playsInline
          className="max-h-[70vh] w-full"
        />
      </div>

      {fence.title && (
        <div className="border-t border-card-border px-4 py-2.5">
          <p className="text-sm whitespace-pre-wrap text-text-secondary wrap-break-word">
            {fence.title}
          </p>
        </div>
      )}
    </div>
  );
}

function VideoSkeleton() {
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-card-border bg-card-bg">
      <div className="flex items-center justify-between border-b border-card-border px-4 py-2">
        <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex justify-center p-5">
        <div className="h-[240px] w-full animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function VideoError() {
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-card-border bg-card-bg">
      <div className="flex items-center justify-between border-b border-card-border px-4 py-2">
        <span className={HEADER_LABEL}>Video</span>
        <span className="pill-red">Error</span>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-[var(--red)]">
          This does not look like a video reference.
        </p>
        <p className="mt-2 text-xs text-text-secondary">
          Expected JSON with a <code>url</code>.
        </p>
      </div>
    </div>
  );
}
