import { describe, expect, it } from "vitest";

import { NSW_CONTOURS } from "./nswContours.js";
import { NSW_COVERAGE } from "./nswCoverage.js";
import { NSW_FIRE } from "./nswFire.js";
import {
  CONTOUR_LABELS_MIN_ZOOM,
  CONTOURS_MIN_ZOOM,
  CONTOURS_MINOR_MIN_ZOOM,
  COVERAGE_MIN_ZOOM,
  FIRE_MIN_ZOOM,
  GAUGES_MIN_ZOOM,
  SLOPE_MIN_ZOOM,
  zoomFadeIn,
} from "./overlayZoom.js";
import { NSW_SLOPE } from "./terrain.js";

describe("zoomFadeIn", () => {
  // Mutation: start the ramp above the minzoom, or end it at a nonzero
  // opacity, and a layer pops in at its minzoom.
  it("is 0 at the minzoom and full a level above", () => {
    expect(zoomFadeIn(8)).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      0,
      9,
      1,
    ]);
  });
});

describe("zoom floors", () => {
  // Mutation: lower CONTOURS_MIN_ZOOM back to the archive's z11.
  it("draw no sooner than their archives hold tiles", () => {
    expect(CONTOURS_MIN_ZOOM).toBeGreaterThan(NSW_CONTOURS.minzoom);
    expect(SLOPE_MIN_ZOOM).toBeGreaterThanOrEqual(NSW_SLOPE.minzoom);
    expect(SLOPE_MIN_ZOOM).toBeLessThanOrEqual(NSW_SLOPE.maxzoom);
    // Mutation: FIRE_MIN_ZOOM outside the archive's z8–z12.
    expect(FIRE_MIN_ZOOM).toBeGreaterThanOrEqual(NSW_FIRE.minzoom);
    expect(FIRE_MIN_ZOOM).toBeLessThan(NSW_FIRE.maxzoom);
    // Mutation: COVERAGE_MIN_ZOOM outside the archive's zooms, or no deeper
    // than fire's.
    expect(COVERAGE_MIN_ZOOM).toBeGreaterThanOrEqual(NSW_COVERAGE.minzoom);
    expect(COVERAGE_MIN_ZOOM).toBeLessThanOrEqual(NSW_COVERAGE.maxzoom);
    expect(COVERAGE_MIN_ZOOM).toBeGreaterThan(FIRE_MIN_ZOOM);
  });
  it("bring contour detail in coarse to fine", () => {
    expect(CONTOURS_MIN_ZOOM).toBeLessThan(CONTOUR_LABELS_MIN_ZOOM);
    expect(CONTOUR_LABELS_MIN_ZOOM).toBeLessThan(CONTOURS_MINOR_MIN_ZOOM);
    expect(GAUGES_MIN_ZOOM).toBeLessThan(CONTOURS_MIN_ZOOM);
  });
});
