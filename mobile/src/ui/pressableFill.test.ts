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
      source("StatusPill.tsx").indexOf("makeStyles("),
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

// The "add one" chip at the end of a rail or vocabulary is a dashed, unfilled
// outline on both clients (Logjam Web's `Chip dashed`), so it never reads as one
// more value to pick. Mutation: drop `dashed` from the Places rail's trailing
// chip or from ChipPicker's Add chip; or make the Chip's `dashed` style paint a
// fill.
describe("an add chip is dashed", () => {
  it("is a Chip prop that draws an edge and no fill", () => {
    const chip = source("Chip.tsx");
    const dashed = chip.slice(chip.indexOf("  dashed: {"));
    expect(dashed).toContain('borderStyle: "dashed"');
    expect(dashed.slice(0, dashed.indexOf("},"))).toContain(
      'backgroundColor: "transparent"',
    );
  });

  it("is what every add chip passes", () => {
    const picker = source("ChipPicker.tsx");
    expect(picker).toMatch(/icon="add"\s+dashed/);
    const places = readFileSync(
      new URL("../places/PlacesScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(places).toMatch(/icon="add"\s+dashed/);
  });
});

describe("a selected chip is not a button", () => {
  it("leads with a check as well as its fill", () => {
    expect(source("Chip.tsx")).toContain('<Icon idea="done"');
  });
});
