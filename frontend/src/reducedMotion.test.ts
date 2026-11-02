import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The global reduced-motion rule in index.css is `!important`, so it beats any
 * component's own `prefers-reduced-motion` block. A block that REPLACES an
 * animation with another one (rather than `animation: none`) only runs on an
 * element the global rule leaves out: `data-own-motion`. Without it the
 * indeterminate progress bar stops at full width and looks finished.
 *
 * Mutation: delete `data-own-motion` from the progress fill in `ui/Feedback.tsx`,
 * or `:not([data-own-motion])` from the rule in index.css.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

// Stylesheets whose reduced-motion block sets an animation of its own, and the
// component that must mark the element.
const OWN_MOTION: Record<string, string> = {
  "ui/Feedback.module.css": "ui/Feedback.tsx",
};

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? stylesheets(join(dir, entry.name))
      : entry.name.endsWith(".css")
        ? [join(dir, entry.name)]
        : [],
  );
}

/** Stylesheets with an `animation:` other than `none` inside a reduced-motion block. */
function ownMotionSheets(): string[] {
  return stylesheets(SRC).flatMap((path) => {
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [
      ...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g),
    ].some((start) => {
      const rest = css.slice((start.index ?? 0) + start[0].length);
      let depth = 1;
      let end = 0;
      while (end < rest.length && depth > 0) {
        depth += rest[end] === "{" ? 1 : rest[end] === "}" ? -1 : 0;
        end++;
      }
      return /animation:\s*(?=\S)(?!none\b)[^;]+;/.test(rest.slice(0, end));
    })
      ? [relative(SRC, path)]
      : [];
  });
}

describe("reduced motion", () => {
  it("leaves out only elements marked data-own-motion", () => {
    const rule = readFileSync(join(SRC, "index.css"), "utf8");
    expect(rule).toContain("*:not([data-own-motion]),");
    expect(rule).toContain("*:not([data-own-motion])::before,");
    expect(rule).toContain("*:not([data-own-motion])::after {");
  });

  it("marks every element whose stylesheet keeps its own motion", () => {
    expect(ownMotionSheets()).toEqual(Object.keys(OWN_MOTION));
    for (const component of Object.values(OWN_MOTION))
      expect(readFileSync(join(SRC, component), "utf8")).toContain(
        "data-own-motion",
      );
  });
});
