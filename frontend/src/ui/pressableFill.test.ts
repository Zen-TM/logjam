import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UX §4, "filled is interactive", for the small things: a status pill is read,
 * so it draws no fill and no edge, and a button always wears the pressable
 * fill; a selected chip is its fill alone, with no check, so selecting never
 * changes its width. Without this the three look-alikes (a button, a status
 * pill and a selected chip) drift back together one tone at a time.
 *
 * Mutation that turns it red: give `.pill[data-tone="accent"]` a `background`
 * (what it had), drop `background: var(--color-card)` from `.pressable`, or
 * give `.button` or `.cardCheckbox` a look of its own instead of composing it,
 * put `<Icon idea="done"` back in Chip.tsx, or paint `.active` with
 * `var(--color-card)`. The accent against the card is held >= 3:1 (WCAG 1.4.11)
 * in every scheme by scripts/wcag-contrast.mjs.
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
  const source = css("Button.module.css");

  it("reads the card colour, and the pressed one under the pointer", () => {
    const [[, base]] = rules(source, (s) => s === ".pressable");
    expect(base).toContain("background: var(--color-card)");
    const [[, hover]] = rules(source, (s) => s.startsWith(".pressable:hover"));
    expect(hover).toContain("var(--color-card-pressed)");
  });

  // The card checkbox sits beside buttons on the map bar: one look, composed.
  it.each([
    ["Button.module.css", ".button", "pressable"],
    [
      "Choice.module.css",
      ".cardCheckbox",
      'pressable from "./Button.module.css"',
    ],
  ])("%s %s composes it and draws no fill of its own", (file, cls, from) => {
    const [[, body]] = rules(css(file), (s) => s === cls);
    expect(body).toContain(`composes: ${from};`);
    expect(body).not.toMatch(/(^|[;\s])(background|border)[a-z-]*\s*:/);
  });

  // `.checkbox` and `.pressable` both set a min-height, and which composed
  // class wins depends on the built CSS's order. Mutation: drop the card
  // checkbox's own min-height (it falls to the plain checkbox's control-md).
  it("gives the card checkbox the pressable's height itself", () => {
    const minHeight = (file: string, cls: string) =>
      rules(css(file), (s) => s === cls)[0][1].match(
        /min-height:\s*([^;]+)/,
      )?.[1];
    expect(minHeight("Choice.module.css", ".cardCheckbox")).toBe(
      minHeight("Button.module.css", ".pressable"),
    );
  });
});

describe("a row you can act on wears the card fill", () => {
  // Red when a row holding Accept / Decline or a ⋯ goes back to bare: it
  // looked broken beside the openable cards around it.
  const source = css("Row.module.css").replace(/\s+/g, " ");

  it.each(["button", "a", "input", '[role="switch"]'])(
    "a footer or trailing %s fills the row",
    (control) => {
      const selector = source.match(
        /\.row:has\( ?:is\(\.trailing, \.footer\) :is\(([^)]*)\)/,
      );
      expect(selector?.[1]).toContain(control);
    },
  );

  it("leaves the read-out row bare", () => {
    expect(source).toMatch(/\.row \{[^}]*background: transparent/);
  });
});

describe("a selected chip is its fill alone", () => {
  it("draws no check", () => {
    expect(readFileSync(join(KIT_DIR, "Chip.tsx"), "utf8")).not.toContain(
      'idea="done"',
    );
  });

  it("fills with its hue, accent by default, not the button's card", () => {
    const [[, active]] = rules(css("Chip.module.css"), (s) => s === ".active");
    expect(active).toContain(
      "background: var(--chip-hue, var(--color-accent))",
    );
  });
});
