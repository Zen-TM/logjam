import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The pinned form of Hero is ONE row: the title, the actions and nothing that
// scrolls with a list (eyebrow, metric, children chips). Mutation: render
// `eyebrow` or `value` inside the `compact` branch, and Saved and Inbox pin
// half the screen again.
describe("Hero compact", () => {
  const source = readFileSync(new URL("./Hero.tsx", import.meta.url), "utf8");
  const branch = source.slice(
    source.indexOf("function CompactHero"),
    source.indexOf("const useStyles"),
  );
  it("draws the row only", () => {
    expect(branch).toContain("styles.compactRow");
    expect(branch).not.toMatch(/eyebrow|\bvalue\b|secondaryValue/);
  });
});
