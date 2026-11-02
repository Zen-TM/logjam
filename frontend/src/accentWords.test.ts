import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * shared/DESIGN.md §7: words are `text` or `textMuted`, never the accent, which
 * is 3:1 on Ghost Gum's page and so fails as text. A link is underlined text.
 * `scripts/wcag-contrast.mjs` holds the pairs a word may sit on; this holds the
 * stylesheets to naming them.
 *
 * Catches a rule that underlines or is named as a link and sets `color` to the
 * accent. It cannot tell a glyph's colour from a word's, so a plain accent
 * `color` elsewhere is reviewed, not tested.
 *
 * Mutation that turns it red: `color: var(--color-accent)` on
 * `.inlineLink` in `UnifiedImportDialog.module.css`.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return stylesheets(path);
    return e.name.endsWith(".module.css") ? [path] : [];
  });
}

describe("accent as the colour of words", () => {
  it("is never a link's colour", () => {
    const offenders: string[] = [];
    for (const path of stylesheets(SRC)) {
      const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const accentColour = /(^|[;\s])color:\s*var\(--color-accent\)/.test(
          body,
        );
        const isLink =
          /text-decoration:\s*underline/.test(body) ||
          /link|(^|[\s>])a\b/i.test(selector);
        if (accentColour && isLink) {
          offenders.push(`${path.slice(SRC.length + 1)}: ${selector.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
