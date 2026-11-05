import { describe, expect, it } from "vitest";

import {
  DEFAULT_SLOPE_SCALE,
  insertSlopeBand,
  nextSlopeBandsEdit,
  removeSlopeBand,
  setSlopeScaleColour,
  setSlopeThreshold,
  setSlopeUpper,
  slopeBoundaryRange,
  slopeScale,
  SLOPE_SCALE_COLOURS,
} from "./slopeBandsEdit.js";
import {
  MAX_SLOPE_BANDS,
  RASTER_TEMPLATE_DEFAULTS,
  slopeBandsError,
  type SlopeBand,
} from "./topoSettings.js";

const BANDS = RASTER_TEMPLATE_DEFAULTS.slope.bands;
const valid = (bands: SlopeBand[] | null) =>
  expect(bands && slopeBandsError(bands)).toBeNull();

// Mutation: let an edit leave a gap or an overlap, and the account would be
// sent bands the API refuses (or, worse, a map that draws a hole).
describe("every edit keeps the bands valid", () => {
  it("setting a threshold, an upper angle, inserting and removing", () => {
    valid(setSlopeThreshold(BANDS, 10));
    valid(setSlopeUpper(BANDS, 1, 55));
    valid(setSlopeUpper(BANDS, BANDS.length - 1, 80));
    for (let position = 0; position <= BANDS.length; position++)
      valid(insertSlopeBand(BANDS, position));
    for (let idx = 0; idx < BANDS.length; idx++)
      valid(removeSlopeBand(BANDS, idx));
  });

  it("any whole number in a boundary's range is accepted", () => {
    const boundaries = ["threshold", 0, 1, 2, 3] as const;
    for (const boundary of boundaries) {
      const { min, max } = slopeBoundaryRange(BANDS, boundary);
      for (const deg of [min, max]) {
        valid(
          boundary === "threshold"
            ? setSlopeThreshold(BANDS, deg)
            : setSlopeUpper(BANDS, boundary, deg),
        );
      }
    }
  });

  it("does not change the bands it was given", () => {
    const before = JSON.stringify(BANDS);
    insertSlopeBand(BANDS, 2);
    removeSlopeBand(BANDS, 1);
    setSlopeUpper(BANDS, 0, 45);
    expect(JSON.stringify(BANDS)).toBe(before);
  });
});

describe("the scale", () => {
  // Mutation: recolour from the placeholder a new band carries, and a band
  // added shows the placeholder red instead of its place on the ramp.
  it("repaints every edit along the ends it had", () => {
    const scale = slopeScale(BANDS);
    for (const edited of [
      insertSlopeBand(BANDS, 2)!,
      removeSlopeBand(BANDS, 1),
      setSlopeUpper(BANDS, 0, 45),
    ])
      expect(slopeScale(edited)).toEqual(scale);
    expect(insertSlopeBand(BANDS, 2)!.map((b) => b.colour)).not.toContain(
      "#ff000080",
    );
  });

  it("changes one end's colour and keeps its opacity", () => {
    const next = setSlopeScaleColour(BANDS, "end", "#2563eb");
    expect(slopeScale(next).end).toBe(
      `#2563eb${DEFAULT_SLOPE_SCALE.end.slice(7)}`,
    );
    expect(slopeScale(next).start).toBe(DEFAULT_SLOPE_SCALE.start);
  });

  it("offers colours that are plain #rrggbb", () => {
    for (const colour of SLOPE_SCALE_COLOURS)
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("limits", () => {
  it("refuses to insert past the most bands a topo can have", () => {
    let bands: SlopeBand[] = BANDS;
    while (bands.length < MAX_SLOPE_BANDS) bands = insertSlopeBand(bands, 0)!;
    expect(bands).toHaveLength(MAX_SLOPE_BANDS);
    expect(insertSlopeBand(bands, 1)).toBeNull();
  });

  it("refuses to insert where there is no room", () => {
    const tight: SlopeBand[] = [
      { fromDeg: 0, toDeg: 1, colour: "#ff0000ff" },
      { fromDeg: 1, toDeg: 2, colour: "#00ff00ff" },
    ];
    expect(insertSlopeBand(tight, 0)).toBeNull();
    expect(insertSlopeBand(tight, 1)).toBeNull();
  });
});

describe("the edit held while the user types", () => {
  it("keeps the last valid bands past an invalid in-between one", () => {
    const first = nextSlopeBandsEdit(null, BANDS);
    const broken = [{ ...BANDS[0], fromDeg: 80 }, ...BANDS.slice(1)];
    const after = nextSlopeBandsEdit(first, broken);
    expect(after.bands).toBe(broken);
    expect(after.lastValid).toBe(BANDS);
  });
});
