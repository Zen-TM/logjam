import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A pill-shaped control is never narrower than it is tall (UX §2, "centred
 * means centred"): its `min-width` is its `min-height`, so a one-glyph or
 * one-digit pill is a circle and not a sliver.
 *
 * Mutation that turns it red: delete `min-width` from `.chip`, or change it to
 * a different token than the `min-height` beside it.
 */
const KIT_DIR = dirname(fileURLToPath(import.meta.url));

const PILL_CONTROLS: [file: string, selector: string][] = [
  ["Button.module.css", ".button"],
  ["Button.module.css", ".compact"],
  ["Chip.module.css", ".chip"],
];

function declaration(body: string, property: string) {
  return new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`).exec(body)?.[1];
}

describe("a pill is never narrower than it is tall", () => {
  it.each(PILL_CONTROLS)("%s %s", (file, selector) => {
    const css = readFileSync(join(KIT_DIR, file), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const body = new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^}]*)\\}`).exec(
      css,
    )?.[1];
    expect(body, `${selector} rule`).toBeDefined();
    const height = declaration(body as string, "min-height");
    expect(height).toMatch(/var\(--control-/);
    expect(declaration(body as string, "min-width")).toBe(height);
  });
});
