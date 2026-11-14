import { readFileSync } from "node:fs";
import { STAT_PAIRS, setDisplayUnits } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { onFootStats } from "./onFootStats";

describe("onFootStats", () => {
  const stats = onFootStats({
    distanceM: 12_300,
    durationMs: 3_600_000,
    ascentM: 410.4,
    longestM: 5000,
  });
  const labels = stats.map((stat) => stat.label);

  // Mutation: put Ascent (or any non-partner) between Time and Distance, or
  // restore the old Distance, Ascent, Time, Longest order, and the pair is
  // split across two rows.
  it("puts Time and Distance side by side as the first row", () => {
    const [first, second] = STAT_PAIRS[0];
    expect(labels.slice(0, 2)).toEqual([first, second]);
  });
  // Mutation: add a fifth stat, or let Ascent or Longest span the row, and
  // the second row is a lone full-width cell instead of a pair.
  it("fills a second row with Ascent beside Longest", () => {
    expect(stats).toHaveLength(4);
    expect(labels.slice(2)).toEqual(["Ascent", "Longest"]);
    expect(stats.every((stat) => !("span" in stat))).toBe(true);
    expect(stats.find((s) => s.label === "Ascent")?.value).toBe("410 m");
  });
  // Mutation: write `${Math.round(t.ascentM)} m` in onFootStats.ts again.
  it("writes the ascent in feet when the display units are imperial", () => {
    setDisplayUnits("imperial");
    try {
      const imperial = onFootStats({
        distanceM: 12_300,
        durationMs: 3_600_000,
        ascentM: 410.4,
        longestM: 5000,
      });
      expect(imperial.find((s) => s.label === "Ascent")?.value).toBe("1346 ft");
    } finally {
      setDisplayUnits("metric");
    }
  });
});

// Rendering StatsScreen needs the whole React Native tree, which this suite
// does not load, so the tie is read from source. Mutation: inline the four
// stats in OnFoot again, in any order.
describe("StatsScreen", () => {
  it("draws the On foot grid from onFootStats", () => {
    const source = readFileSync(
      new URL("./StatsScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/<StatGrid\s+stats=\{onFootStats\(/);
    expect(source).not.toContain('label: "Time"');
  });
});
