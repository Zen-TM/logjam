import { describe, it, expect } from "vitest";
import {
  type ExtentState,
  type PivotPoint,
  getPaperDimensions,
  mapAspectRatio,
  calcScale,
  geoWidthMeters,
  geoHeightMeters,
  applyNorthChange,
  applySouthChange,
  applyEastChange,
  applyWestChange,
  applyScaleChange,
  applyPaperChange,
  applyOrientationChange,
  applyPivotChange,
  applyCoordModeChange,
  detectMgaZone,
  toEastingNorthing,
  fromEastingNorthing,
  gridConvergence,
} from "./geoPdfExtent";

// ── Test Helpers ─────────────────────────────────────────────────────────────

/** Base state centred on the Blue Mountains, NSW. A4 portrait, 1:25000. */
function baseState(overrides?: Partial<ExtentState>): ExtentState {
  // ~8.5km × ~7.4km area at 1:25000 on A4
  return {
    paperSize: "A4",
    orientation: "portrait",
    north: -33.65,
    south: -33.72,
    east: 150.35,
    west: 150.28,
    scale: 25000,
    coordMode: "latlon",
    lockMode: "scale",
    pivot: "mc",
    ...overrides,
  };
}

/** Assert that the map aspect ratio matches the paper aspect ratio within tolerance. */
function assertRatioInvariant(state: ExtentState, tolerance = 0.01) {
  const paper = getPaperDimensions(state);
  const paperRatio = paper.w / paper.h;
  const mapRatio = mapAspectRatio(state);
  expect(mapRatio).toBeCloseTo(paperRatio, 1);
}

/** Assert that north > south and east > west. */
function assertValidBounds(state: ExtentState) {
  expect(state.north).toBeGreaterThan(state.south);
  expect(state.east).toBeGreaterThan(state.west);
}

// ── Paper Dimensions ─────────────────────────────────────────────────────────

describe("getPaperDimensions", () => {
  it("returns A4 portrait dimensions", () => {
    const dims = getPaperDimensions(baseState());
    expect(dims).toEqual({ w: 210, h: 297 });
  });

  it("returns A4 landscape dimensions (swapped)", () => {
    const dims = getPaperDimensions(baseState({ orientation: "landscape" }));
    expect(dims).toEqual({ w: 297, h: 210 });
  });

  it("returns A3 portrait dimensions", () => {
    const dims = getPaperDimensions(baseState({ paperSize: "A3" }));
    expect(dims).toEqual({ w: 297, h: 420 });
  });

  it("handles custom ratio", () => {
    const dims = getPaperDimensions(
      baseState({ paperSize: "custom", customRatio: { w: 300, h: 400 } }),
    );
    expect(dims).toEqual({ w: 300, h: 400 });
  });

  it("handles custom ratio with landscape", () => {
    const dims = getPaperDimensions(
      baseState({ paperSize: "custom", customRatio: { w: 300, h: 400 }, orientation: "landscape" }),
    );
    expect(dims).toEqual({ w: 400, h: 300 });
  });
});

// ── applyNorthChange ─────────────────────────────────────────────────────────

describe("applyNorthChange", () => {
  describe("Lock Scale mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`pans with pivot=${pivot}, preserving scale and ratio`, () => {
        const state = baseState({ lockMode: "scale", pivot });
        const height = state.north - state.south;
        const newNorth = state.north + 0.01;
        const result = applyNorthChange(state, newNorth);

        // Height should be preserved (pan)
        expect(result.north - result.south).toBeCloseTo(height, 6);
        // South should have moved by the same delta
        expect(result.south).toBeCloseTo(state.south + 0.01, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  describe("Lock Position mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`adjusts scale with pivot=${pivot}, preserving ratio`, () => {
        const state = baseState({ lockMode: "position", pivot });
        const newNorth = state.north + 0.01;
        const result = applyNorthChange(state, newNorth);

        // North changed, south stays
        expect(result.north).toBeCloseTo(newNorth, 6);
        expect(result.south).toBeCloseTo(state.south, 6);
        // Scale should have changed
        expect(result.scale).not.toBeCloseTo(state.scale, 0);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  it("rejects newNorth <= south", () => {
    const state = baseState();
    const result = applyNorthChange(state, state.south - 0.01);
    expect(result).toEqual(state);
  });
});

// ── applySouthChange ─────────────────────────────────────────────────────────

describe("applySouthChange", () => {
  describe("Lock Scale mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`pans with pivot=${pivot}, preserving scale and ratio`, () => {
        const state = baseState({ lockMode: "scale", pivot });
        const height = state.north - state.south;
        const newSouth = state.south - 0.01;
        const result = applySouthChange(state, newSouth);

        expect(result.north - result.south).toBeCloseTo(height, 6);
        expect(result.north).toBeCloseTo(state.north - 0.01, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  describe("Lock Position mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`adjusts scale with pivot=${pivot}, preserving ratio`, () => {
        const state = baseState({ lockMode: "position", pivot });
        const newSouth = state.south - 0.01;
        const result = applySouthChange(state, newSouth);

        expect(result.south).toBeCloseTo(newSouth, 6);
        expect(result.north).toBeCloseTo(state.north, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  it("rejects newSouth >= north", () => {
    const state = baseState();
    const result = applySouthChange(state, state.north + 0.01);
    expect(result).toEqual(state);
  });
});

// ── applyEastChange ──────────────────────────────────────────────────────────

describe("applyEastChange", () => {
  describe("Lock Scale mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`pans with pivot=${pivot}, preserving scale and ratio`, () => {
        const state = baseState({ lockMode: "scale", pivot });
        const width = state.east - state.west;
        const newEast = state.east + 0.01;
        const result = applyEastChange(state, newEast);

        expect(result.east - result.west).toBeCloseTo(width, 6);
        expect(result.west).toBeCloseTo(state.west + 0.01, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  describe("Lock Position mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`adjusts scale with pivot=${pivot}, preserving ratio`, () => {
        const state = baseState({ lockMode: "position", pivot });
        const newEast = state.east + 0.01;
        const result = applyEastChange(state, newEast);

        expect(result.east).toBeCloseTo(newEast, 6);
        expect(result.west).toBeCloseTo(state.west, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  it("rejects newEast <= west", () => {
    const state = baseState();
    const result = applyEastChange(state, state.west - 0.01);
    expect(result).toEqual(state);
  });
});

// ── applyWestChange ──────────────────────────────────────────────────────────

describe("applyWestChange", () => {
  describe("Lock Scale mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`pans with pivot=${pivot}, preserving scale and ratio`, () => {
        const state = baseState({ lockMode: "scale", pivot });
        const width = state.east - state.west;
        const newWest = state.west - 0.01;
        const result = applyWestChange(state, newWest);

        expect(result.east - result.west).toBeCloseTo(width, 6);
        expect(result.east).toBeCloseTo(state.east - 0.01, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  describe("Lock Position mode", () => {
    const pivots: PivotPoint[] = ["tl", "mc", "br"];
    for (const pivot of pivots) {
      it(`adjusts scale with pivot=${pivot}, preserving ratio`, () => {
        const state = baseState({ lockMode: "position", pivot });
        const newWest = state.west - 0.01;
        const result = applyWestChange(state, newWest);

        expect(result.west).toBeCloseTo(newWest, 6);
        expect(result.east).toBeCloseTo(state.east, 6);
        assertRatioInvariant(result);
        assertValidBounds(result);
      });
    }
  });

  it("rejects newWest >= east", () => {
    const state = baseState();
    const result = applyWestChange(state, state.east + 0.01);
    expect(result).toEqual(state);
  });
});

// ── applyScaleChange ─────────────────────────────────────────────────────────

describe("applyScaleChange", () => {
  it("expands around centre pivot", () => {
    const state = baseState({ pivot: "mc" });
    const centreLatBefore = (state.north + state.south) / 2;
    const centreLonBefore = (state.east + state.west) / 2;

    const result = applyScaleChange(state, 50000);

    // Centre should remain approximately the same
    const centreLatAfter = (result.north + result.south) / 2;
    const centreLonAfter = (result.east + result.west) / 2;
    expect(centreLatAfter).toBeCloseTo(centreLatBefore, 4);
    expect(centreLonAfter).toBeCloseTo(centreLonBefore, 4);

    // Area should be larger
    expect(result.north - result.south).toBeGreaterThan(state.north - state.south);
    expect(result.east - result.west).toBeGreaterThan(state.east - state.west);

    assertRatioInvariant(result);
    assertValidBounds(result);
    expect(result.scale).toBe(50000);
  });

  it("expands around corner pivot tl (top-left fixed)", () => {
    const state = baseState({ pivot: "tl" });
    const result = applyScaleChange(state, 50000);

    // Top-left should be fixed
    expect(result.north).toBeCloseTo(state.north, 6);
    expect(result.west).toBeCloseTo(state.west, 6);
    // Bottom-right should move outward
    expect(result.south).toBeLessThan(state.south);
    expect(result.east).toBeGreaterThan(state.east);

    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("expands around edge pivot tc (top edge fixed)", () => {
    const state = baseState({ pivot: "tc" });
    const centreLonBefore = (state.east + state.west) / 2;

    const result = applyScaleChange(state, 50000);

    // Top should be fixed
    expect(result.north).toBeCloseTo(state.north, 6);
    // Bottom moves down
    expect(result.south).toBeLessThan(state.south);
    // E/W expand equally — centre lon preserved
    const centreLonAfter = (result.east + result.west) / 2;
    expect(centreLonAfter).toBeCloseTo(centreLonBefore, 4);

    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("contracts around br pivot when scale decreases", () => {
    const state = baseState({ pivot: "br" });
    const result = applyScaleChange(state, 10000);

    // Bottom-right should be fixed
    expect(result.south).toBeCloseTo(state.south, 6);
    expect(result.east).toBeCloseTo(state.east, 6);
    // Area should be smaller
    expect(result.north - result.south).toBeLessThan(state.north - state.south);

    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("rejects scale <= 0", () => {
    const state = baseState();
    expect(applyScaleChange(state, 0)).toEqual(state);
    expect(applyScaleChange(state, -1000)).toEqual(state);
  });
});

// ── applyPaperChange ─────────────────────────────────────────────────────────

describe("applyPaperChange", () => {
  it("changes from A4 to A3, preserving scale", () => {
    const state = baseState({ pivot: "mc" });
    const result = applyPaperChange(state, "A3");

    // Scale should be approximately preserved
    const resultScale = calcScale(result);
    expect(resultScale).toBeCloseTo(state.scale, -2);

    // Area should be larger (A3 > A4)
    expect(geoWidthMeters(result)).toBeGreaterThan(geoWidthMeters(state));

    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("changes to A5, preserving scale", () => {
    const state = baseState({ pivot: "mc" });
    const result = applyPaperChange(state, "A5");

    // Area should be smaller (A5 < A4)
    expect(geoWidthMeters(result)).toBeLessThan(geoWidthMeters(state));

    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("changes to custom ratio", () => {
    const state = baseState({ pivot: "mc" });
    const result = applyPaperChange(state, "custom", { w: 300, h: 300 });

    // 300:300 is square → map should be approximately square
    const paper = getPaperDimensions(result);
    expect(paper.w / paper.h).toBeCloseTo(1, 2);

    assertRatioInvariant(result);
    assertValidBounds(result);
  });
});

// ── applyOrientationChange ───────────────────────────────────────────────────

describe("applyOrientationChange", () => {
  it("swaps from portrait to landscape", () => {
    const state = baseState({ orientation: "portrait", pivot: "mc" });
    const result = applyOrientationChange(state, "landscape");

    expect(result.orientation).toBe("landscape");

    // Paper ratio should have inverted
    const paperBefore = getPaperDimensions(state);
    const paperAfter = getPaperDimensions(result);
    expect(paperAfter.w / paperAfter.h).toBeCloseTo(paperBefore.h / paperBefore.w, 2);

    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("no-ops when already in target orientation", () => {
    const state = baseState({ orientation: "landscape" });
    const result = applyOrientationChange(state, "landscape");
    expect(result).toEqual(state);
  });
});

// ── applyPivotChange ─────────────────────────────────────────────────────────

describe("applyPivotChange", () => {
  it("changes pivot without affecting extents", () => {
    const state = baseState({ pivot: "mc" });
    const result = applyPivotChange(state, "tl");

    expect(result.pivot).toBe("tl");
    expect(result.north).toBe(state.north);
    expect(result.south).toBe(state.south);
    expect(result.east).toBe(state.east);
    expect(result.west).toBe(state.west);
    expect(result.scale).toBe(state.scale);
  });
});

// ── applyCoordModeChange ─────────────────────────────────────────────────────

describe("applyCoordModeChange", () => {
  it("changes coord mode without affecting extents", () => {
    const state = baseState({ coordMode: "latlon" });
    const result = applyCoordModeChange(state, "enNorthing");

    expect(result.coordMode).toBe("enNorthing");
    expect(result.north).toBe(state.north);
    expect(result.south).toBe(state.south);
    expect(result.east).toBe(state.east);
    expect(result.west).toBe(state.west);
    expect(result.scale).toBe(state.scale);
  });
});

// ── Coordinate Conversion ────────────────────────────────────────────────────

describe("coordinate conversion", () => {
  it("detects MGA zone 56 for Sydney longitude", () => {
    expect(detectMgaZone(151.2)).toBe(56);
  });

  it("detects MGA zone 55 for Melbourne longitude", () => {
    expect(detectMgaZone(144.9)).toBe(55);
  });

  it("detects MGA zone 54 for Adelaide longitude", () => {
    expect(detectMgaZone(138.6)).toBe(54);
  });

  it("round-trips lat/lon → easting/northing → lat/lon", () => {
    const lat = -33.685;
    const lon = 150.315;
    const { easting, northing, zone } = toEastingNorthing(lat, lon);
    const back = fromEastingNorthing(easting, northing, zone);

    expect(back.lat).toBeCloseTo(lat, 4);
    expect(back.lon).toBeCloseTo(lon, 4);
  });

  it("round-trips for zone 55", () => {
    const lat = -37.8;
    const lon = 145.0;
    const { easting, northing, zone } = toEastingNorthing(lat, lon);
    expect(zone).toBe(55);
    const back = fromEastingNorthing(easting, northing, zone);
    expect(back.lat).toBeCloseTo(lat, 4);
    expect(back.lon).toBeCloseTo(lon, 4);
  });

  it("returns reasonable easting/northing values", () => {
    const { easting, northing } = toEastingNorthing(-33.685, 150.315);
    // Easting should be around 200k–800k for MGA zones
    expect(easting).toBeGreaterThan(100000);
    expect(easting).toBeLessThan(900000);
    // Northing should be around 6000k–7000k for southern NSW
    expect(northing).toBeGreaterThan(5000000);
    expect(northing).toBeLessThan(7000000);
  });
});

describe("gridConvergence", () => {
  it("returns ~0 at the central meridian of zone 56", () => {
    // Central meridian of zone 56 is 153°E
    const conv = gridConvergence(-33.0, 153.0);
    expect(Math.abs(conv)).toBeLessThan(0.01);
  });

  it("returns non-zero away from central meridian", () => {
    const conv = gridConvergence(-33.0, 150.0);
    expect(Math.abs(conv)).toBeGreaterThan(0.1);
  });
});

// ── Invariant: ratio preserved across all mutations ──────────────────────────

describe("ratio invariant across all mutations", () => {
  const allPivots: PivotPoint[] = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];

  for (const pivot of allPivots) {
    it(`holds after applyScaleChange with pivot=${pivot}`, () => {
      const state = baseState({ pivot });
      const result = applyScaleChange(state, 50000);
      assertRatioInvariant(result);
      assertValidBounds(result);
    });
  }

  for (const pivot of allPivots) {
    it(`holds after applyNorthChange (Lock Position) with pivot=${pivot}`, () => {
      const state = baseState({ lockMode: "position", pivot });
      const result = applyNorthChange(state, state.north + 0.02);
      assertRatioInvariant(result);
      assertValidBounds(result);
    });
  }

  for (const pivot of allPivots) {
    it(`holds after applyEastChange (Lock Position) with pivot=${pivot}`, () => {
      const state = baseState({ lockMode: "position", pivot });
      const result = applyEastChange(state, state.east + 0.02);
      assertRatioInvariant(result);
      assertValidBounds(result);
    });
  }

  it("holds after paper change A4→A2", () => {
    const state = baseState();
    const result = applyPaperChange(state, "A2");
    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("holds after orientation change portrait→landscape", () => {
    const state = baseState();
    const result = applyOrientationChange(state, "landscape");
    assertRatioInvariant(result);
    assertValidBounds(result);
  });

  it("holds after chained mutations", () => {
    let state = baseState({ pivot: "tl", lockMode: "position" });
    state = applyScaleChange(state, 50000);
    assertRatioInvariant(state);
    state = applyNorthChange(state, state.north + 0.05);
    assertRatioInvariant(state);
    state = applyEastChange(state, state.east + 0.03);
    assertRatioInvariant(state);
    state = applyOrientationChange(state, "landscape");
    assertRatioInvariant(state);
    state = applyPaperChange(state, "A3");
    assertRatioInvariant(state);
    assertValidBounds(state);
  });
});
