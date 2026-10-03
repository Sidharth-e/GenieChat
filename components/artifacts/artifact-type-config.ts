import { Image, FileCode, BarChart3, GitBranch, Component, ScanLine, File } from "lucide-react";
import type { ArtifactType } from "@/lib/artifacts/types";

/**
 * Per-type presentation, shared by the grid card and the list row so the two
 * views cannot drift on an icon, a label or a colour.
 *
 * `iconColorClass` tints the large glyph a thumbnail-less tile shows, and reads
 * a design token rather than a raw Tailwind colour so the type stays legible in
 * both themes. `label` is not decoration: with the type pill gone from both
 * views, the glyph is the only thing distinguishing a chart from a diagram, so
 * the label is what gives that glyph an accessible name.
 */
export interface ArtifactTypeConfig {
  icon: typeof Image;
  label: string;
  iconColorClass: string;
}

export const ARTIFACT_TYPE_CONFIG: Record<ArtifactType, ArtifactTypeConfig> = {
  image: {
    icon: Image,
    label: "Image",
    iconColorClass: "text-[var(--purple)]",
  },
  file: {
    icon: File,
    label: "File",
    iconColorClass: "text-[var(--blue)]",
  },
  chart: {
    icon: BarChart3,
    label: "Chart",
    iconColorClass: "text-[var(--green)]",
  },
  mermaid: {
    icon: GitBranch,
    label: "Diagram",
    iconColorClass: "text-[var(--amber)]",
  },
  canvas: {
    icon: Component,
    label: "Canvas",
    iconColorClass: "text-[var(--blue)]",
  },
  scancode: {
    icon: ScanLine,
    label: "Scan code",
    iconColorClass: "text-[var(--blue)]",
  },
  code_sandbox: {
    icon: FileCode,
    label: "Code Output",
    iconColorClass: "text-[var(--green)]",
  },
};
