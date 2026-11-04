import { STAT_PAIRS } from "@logjam/shared";
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
  // Mutation: add a fifth stat and the last row hangs a lone cell.
  it("fills two whole rows", () => {
    expect(stats).toHaveLength(4);
    expect(stats.find((s) => s.label === "Ascent")?.value).toBe("410 m");
  });
});
