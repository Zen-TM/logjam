import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UX §4, "filled is interactive", for the small things: a status pill is read,
 * so it draws no fill and no edge, and a button always wears the pressable
 * fill. Without this the three look-alikes (a button, a status pill and a
 * selected chip) drift back together one tone at a time.
 *
 * Mutation that turns it red: give `.pill[data-tone="accent"]` a `background`
 * (what it had), or drop `background: var(--color-card)` from `.button`.
 */
const KIT_DIR = dirname(fileURLToPath(import.meta.url));
const css = (name: string) => readFileSync(join(KIT_DIR, name), "utf8");

/** Every rule whose selector list matches, as [selector, declarations]. */
function rules(source: string, match: (selector: string) => boolean) {
  const found: [string, string][] = [];
  for (const m of source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (match(selector)) found.push([selector, m[2]]);
  }
  return found;
}

describe("a status pill has no fill", () => {
  const pillRules = rules(
    css("Feedback.module.css"),
    (selector) => selector.startsWith(".pill") && !selector.includes("::"),
  );

  it("finds the pill's rules", () => {
    expect(pillRules.length).toBeGreaterThan(1);
  });

  it.each(pillRules)("%s draws no background and no border", (_s, body) => {
    expect(body).not.toMatch(/(^|[;\s])(background|border)[a-z-]*\s*:/);
  });
});

describe("a button wears the pressable fill", () => {
  it("reads the card colour, and the pressed one under the pointer", () => {
    const source = css("Button.module.css");
    const [[, base]] = rules(source, (s) => s === ".button");
    expect(base).toContain("background: var(--color-card)");
    expect(source).toContain("var(--color-card-pressed)");
  });
});
