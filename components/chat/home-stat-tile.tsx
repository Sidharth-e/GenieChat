import * as React from "react";

interface HomeStatTileProps {
  /** Mono, upper-case, and the only thing naming what the number is. */
  label: string;
  /** The number itself. A node so a tile can carry an inline mark beside it. */
  value: React.ReactNode;
  /** The qualifying line under the number, when the bare total would mislead. */
  detail?: React.ReactNode;
}

/**
 * One cell of the home screen's stat row.
 *
 * The four tiles share a frame and differ only in what they say, so the frame
 * lives here rather than four times over in the page.
 */
export function HomeStatTile({ label, value, detail }: HomeStatTileProps) {
  return (
    <div className="border border-card-border p-6 bg-card-bg flex flex-col group hover:border-tertiary/40 transition-colors rounded-sm">
      <span className="font-mono text-[10px] text-tertiary/40 uppercase tracking-wider mb-2">
        {label}
      </span>
      <span className="font-serif text-3xl text-foreground">{value}</span>
      {detail ? (
        <span className="font-sans text-xs text-tertiary/40 mt-1.5">{detail}</span>
      ) : null}
    </div>
  );
}
