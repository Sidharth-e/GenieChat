import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Guards the class of bug where `bg-primary` flips with the theme but the text
 * placed on it does not.
 *
 * `--color-primary` is `var(--accent)`, which is `#171717` in light and
 * `#f5f5f5` in dark — so every `bg-primary` surface is near-WHITE in dark mode.
 * A paired foreground that does not flip renders white-on-white. That shipped:
 * `text-primary-foreground` was used in nine places while
 * `--color-primary-foreground` was defined nowhere, so Tailwind emitted no rule
 * and the text silently inherited `--text`. Hardcoded `text-white` failed the
 * same way at thirteen more.
 *
 * Two assertions: the token exists and contrasts in every theme block, and
 * every `*-foreground` utility actually used in the source has a token behind
 * it — the second is what makes the first hold for tokens added later.
 */

const ROOT = resolve(process.cwd());
const CSS = readFileSync(join(ROOT, "app/globals.css"), "utf8");

// --- contrast maths (WCAG 2.1) ---------------------------------------------

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const channel = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linearize(channel(0)) +
    0.7152 * linearize(channel(1)) +
    0.0722 * linearize(channel(2))
  );
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [
    relativeLuminance(a),
    relativeLuminance(b),
  ].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Reads a literal hex token out of one theme block. */
function token(block: string, name: string): string | null {
  const match = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
  return match ? match[1] : null;
}

const THEME_BLOCKS = (() => {
  const light = CSS.slice(CSS.indexOf(":root,"), CSS.indexOf(".dark,"));
  const dark = CSS.slice(
    CSS.indexOf(".dark,"),
    CSS.indexOf("@media (prefers-color-scheme: dark)"),
  );
  const media = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)"));
  return { light, dark, media };
})();

describe("primary/primary-foreground contrast", () => {
  it.each(Object.entries(THEME_BLOCKS))(
    "%s theme keeps text legible on a bg-primary surface",
    (_name, block) => {
      const background = token(block, "--primary");
      const foreground = token(block, "--primary-foreground");

      expect(background, "--primary must be a literal hex").toBeTruthy();
      expect(
        foreground,
        "--primary-foreground must be defined in this theme block",
      ).toBeTruthy();

      expect(contrastRatio(background!, foreground!)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

// --- every used `*-foreground` utility must have a token -------------------

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("foreground utilities resolve to a defined token", () => {
  it("has a --color-* token for every *-foreground class in the source", () => {
    const defined = new Set(
      [...CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );

    const used = new Map<string, string>();
    for (const dir of ["components", "app"]) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(
          /\b(?:bg|text|border|fill|ring)-([a-z0-9-]+?)-foreground\b/g,
        )) {
          used.set(`${match[1]}-foreground`, file.replace(`${ROOT}/`, ""));
        }
      }
    }

    const missing = [...used.entries()]
      .filter(([name]) => !defined.has(name))
      .map(([name, file]) => `${name} (first used in ${file})`);

    expect(
      missing,
      "these utilities are used but have no --color-* token, so Tailwind emits no rule",
    ).toEqual([]);
  });
});
