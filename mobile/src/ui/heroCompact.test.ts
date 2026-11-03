import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The pinned form of Hero is ONE row: the title, the actions and nothing that
// scrolls with a list (eyebrow, metric, children chips). Mutation: render
// `eyebrow` or `value` inside the `compact` branch, and Saved and Inbox pin
// half the screen again.
describe("Hero compact", () => {
  const source = readFileSync(new URL("./Hero.tsx", import.meta.url), "utf8");
  const branch = source
    .slice(
      source.indexOf("function CompactHero"),
      source.indexOf("const useStyles"),
    )
    .replace(/\{\/\*[\s\S]*?\*\/\}|\/\/.*|\/\*[\s\S]*?\*\//g, "");
  it("draws the row only", () => {
    expect(branch).toContain("styles.compactRow");
    expect(branch).not.toMatch(/eyebrow|\bvalue\b|secondaryValue/);
  });
  // Mutation: drop the accessibilityLabel, and the icon-only back has no name.
  it("keeps the back button's accessible name", () => {
    expect(branch).toContain("accessibilityLabel={`Back to ${backLabel}`}");
  });
});

// The chips scroll away, so the pinned row is the only thing left to say a
// list is filtered. Mutation: set Saved's compact title back to "Saved".
describe("Saved's compact title", () => {
  it("names the active filter", () => {
    const saved = readFileSync(
      new URL("../saved/SavedScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(saved).toContain("`Saved · ${CATEGORY_META[filter].plural}`");
  });
});

// A row's trailing column drops under its words at large text. Mutation: drop
// `textScale >= 1.3` from Row, or `rightBelow` from the Saved or Place row.
describe("Row's trailing column at large text", () => {
  it("stacks under the title for the rows that opt in", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("./Row.tsx")).toMatch(
      /rightBelow && right != null && textScale >= 1\.3/,
    );
    expect(read("../saved/SavedScreen.tsx")).toContain("rightBelow");
    expect(read("../places/PlacesScreen.tsx")).toContain("rightBelow");
  });
});
