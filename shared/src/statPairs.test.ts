import { describe, expect, it } from "vitest";
import {
  PAIRED_STAT_LABELS as L,
  pairedStatLayout,
  STAT_PAIRS,
} from "./statPairs.js";

const stat = (label: string) => ({ label, value: "1" });

describe("pairedStatLayout", () => {
  // Red when a pair is split (its second lands elsewhere) or a lone stat is
  // left to share a row with a stranger.
  it("keeps a pair on one row and gives a lone stat the whole row", () => {
    const out = pairedStatLayout([
      stat("Distance"),
      stat(L.ascent),
      stat(L.descent),
      stat(L.highPoint),
      stat("Size"),
      stat(L.lowPoint),
    ]);
    expect(out.map((s) => [s.label, Boolean(s.span)])).toEqual([
      ["Distance", true],
      [L.ascent, false],
      [L.descent, false],
      [L.highPoint, false],
      [L.lowPoint, false],
      ["Size", true],
    ]);
  });

  it("spans a stat whose partner is not on the grid", () => {
    expect(pairedStatLayout([stat(L.ascent)])[0].span).toBe(true);
  });

  it("never names a label in two pairs", () => {
    const labels = STAT_PAIRS.flat();
    expect(new Set(labels).size).toBe(labels.length);
  });
});
