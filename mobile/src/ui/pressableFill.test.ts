import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// UX §4, "filled is interactive", for the small things: a status pill is read,
// so it draws no fill and no edge; a button always wears the pressable fill; a
// selected chip is a fill with a check, so it is neither. Without this the three
// look-alikes drift back together one tone at a time.
//
// Mutations that turn it red: give a StatusPill style a `backgroundColor` (what
// the accent tone had); drop `backgroundColor: theme.card` from Button's base;
// drop the check from an active Chip.
const source = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("a status pill has no fill", () => {
  it("draws no background and no border", () => {
    const styles = source("StatusPill.tsx").slice(
      source("StatusPill.tsx").indexOf("StyleSheet.create"),
    );
    // The dot is the one filled thing in it, and it is passed inline.
    expect(styles).not.toMatch(/(backgroundColor|borderWidth|borderColor)\s*:/);
  });
});

describe("a button wears the pressable fill", () => {
  it("reads the card colour, and the pressed one when pressed", () => {
    const button = source("Button.tsx");
    const base = button.slice(
      button.indexOf("  base: {"),
      button.indexOf("  compact: {"),
    );
    expect(base).toContain("backgroundColor: theme.card");
    expect(button).toContain("pressed: { backgroundColor: theme.cardPressed }");
  });
});

describe("a selected chip is not a button", () => {
  it("leads with a check as well as its fill", () => {
    expect(source("Chip.tsx")).toContain('<Icon idea="done"');
  });
});
