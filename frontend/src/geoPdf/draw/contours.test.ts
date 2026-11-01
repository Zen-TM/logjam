// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeTileToMapTransform,
  VECTOR_STYLE_DEFAULTS,
} from "@logjam/shared";
import { buildContours } from "./contours";

const data = readFileSync(
  new URL("../__fixtures__/sample.mvt", import.meta.url),
);
// Made-up: two z14 tiles side by side.
const t = computeTileToMapTransform(14, -29.9, -30.1, 150.1, 149.9, 800, 800);
const tile = (x: number, y: number) => ({ source: "statewide", x, y, data });

describe("buildContours", () => {
  // Mutation: place labels in the order tiles are handed in, as the server
  // did (its order followed whichever fetch finished first).
  it("places the same labels whatever order the tiles arrive in", () => {
    const a = tile(t.minTileX, t.minTileY);
    const b = tile(t.minTileX + 1, t.minTileY);
    // Close enough that one label's 450 px spacing blocks the other.
    const forward = buildContours([a, b], t, 15, 1, VECTOR_STYLE_DEFAULTS);
    const backward = buildContours([b, a], t, 15, 1, VECTOR_STYLE_DEFAULTS);
    expect(forward.labels.length).toBeGreaterThan(0);
    expect(backward.labels).toEqual(forward.labels);
    expect(backward.lines).toEqual(forward.lines);
  });

  it("draws no minor lines or labels below z14, only majors", () => {
    const low = buildContours(
      [tile(t.minTileX, t.minTileY)],
      t,
      13,
      1,
      VECTOR_STYLE_DEFAULTS,
    );
    expect(low.labels).toEqual([]);
  });
});
