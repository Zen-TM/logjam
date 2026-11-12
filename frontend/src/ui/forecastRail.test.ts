import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A weather row lives inside the scrolling sidebar and must not fight it: it
 * keeps a sideways swipe to itself, snaps a card to its edge, shows ‹ › only
 * to a mouse, and never takes the wheel from the panel.
 *
 * Mutations that turn it red: drop `overscroll-behavior-x: contain` or
 * `scroll-snap-type` from `.track`; show `.buttons` without the
 * `(pointer: fine)` query; add an `onWheel` to ForecastRail.tsx; give `.card` a
 * `background` (a read-only card wears no fill, shared/DESIGN.md §4).
 */
const dir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(dir, file), "utf8");
const css = read("ForecastRail.module.css").replace(/\/\*[\s\S]*?\*\//g, "");

const block = (selector: string) =>
  css.match(new RegExp(`(?:^|})\\s*${selector}\\s*{([^}]*)}`))?.[1] ?? "";

describe("ForecastRail", () => {
  it("keeps its sideways scroll to itself and snaps", () => {
    const track = block("\\.track");
    expect(track).toContain("overflow-x: auto");
    expect(track).toContain("overscroll-behavior-x: contain");
    expect(track).toMatch(/scroll-snap-type: x /);
  });

  it("shows its buttons to a mouse only", () => {
    expect(block("\\.buttons")).toContain("display: none");
    expect(css).toMatch(
      /@media \(pointer: fine\)\s*{\s*\.buttons\s*{[^}]*display: flex/,
    );
  });

  it("takes no wheel and paints no fill on a card", () => {
    expect(read("ForecastRail.tsx")).not.toMatch(/wheel|onWheel/i);
    expect(block("\\.card")).not.toMatch(/background/);
  });
});
