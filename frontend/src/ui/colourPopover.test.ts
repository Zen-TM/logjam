import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The colour palette's popover hugs its swatches (shared/DESIGN.md §3, §10).
 * `Popover` is 372px for the Layers list; a picker's panel was that wide too
 * whenever the kit's stylesheet loaded after the picker's own, which is why
 * the width is a prop of the `Popover` and written after `.popover` in the same
 * file, never a width a caller sets from its own stylesheet.
 *
 * Mutation that turns it red: drop `fit` from either `Popover` in
 * `ColourField.tsx`, or give `.swatchGrid`'s popover a `width` of its own.
 */
const KIT_DIR = dirname(fileURLToPath(import.meta.url));
const read = (file: string) =>
  readFileSync(join(KIT_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("a colour popover is sized by its contents", () => {
  it("declares `fit` after the default it replaces", () => {
    const css = read("Menu.module.css");
    expect(css).toMatch(/\.fit\s*\{[^}]*width:\s*max-content/);
    expect(css.indexOf(".fit {")).toBeGreaterThan(css.indexOf(".popover {"));
  });

  it("opens every ColourField popover with it", () => {
    const tsx = read("ColourField.tsx");
    const popovers =
      tsx.match(/<Popover\b[\s\S]*?dismissOnOutsidePress/g) ?? [];
    expect(popovers.length).toBe(2);
    for (const popover of popovers) expect(popover).toMatch(/\bfit\b/);
  });

  it("leaves its width to the kit", () => {
    for (const file of ["ColourField.module.css", "Choice.module.css"]) {
      expect(read(file)).not.toMatch(/\.(popover|swatchPopover)\s*\{/);
    }
  });
});
