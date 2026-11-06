import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * shared/DESIGN.md §7: words are `text` or `textMuted`, never the accent, which
 * is 3:1 on Ghost Gum's page and so fails as text.
 *
 * Catches a style that spreads a type role and sets its `color` to the accent:
 * that is a word. A glyph's colour is set the same way without a type role, so
 * it passes.
 *
 * Mutation that turns it red: `color: theme.accent` on `addTileLabel` in
 * `media/MediaStrip.tsx`.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path] : [];
  });
}

describe("accent as the colour of words", () => {
  it("is never the colour of a style built on a type role", () => {
    const offenders: string[] = [];
    for (const path of sources(SRC)) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/\.\.\.textRole\.\w+[^}]*color:\s*theme\.accent\b/.test(line)) {
            offenders.push(`${path.slice(SRC.length + 1)}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
