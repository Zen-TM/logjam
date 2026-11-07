import { describe, expect, it } from "vitest";

import {
  CONTOUR_LABELS_MIN_ZOOM,
  CONTOURS_MIN_ZOOM,
  CONTOURS_MINOR_MIN_ZOOM,
  GAUGES_MIN_ZOOM,
  SLOPE_MIN_ZOOM,
  zoomFadeIn,
} from "./overlayZoom.js";
import { NSW_REGION } from "./regions.js";

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
    expect(CONTOURS_MIN_ZOOM).toBeGreaterThan(
      NSW_REGION.terrain.contours.minzoom,
    );
    expect(SLOPE_MIN_ZOOM).toBeGreaterThanOrEqual(
      NSW_REGION.terrain.slope.minzoom,
    );
    expect(SLOPE_MIN_ZOOM).toBeLessThanOrEqual(
      NSW_REGION.terrain.slope.maxzoom,
    );
  });
  it("bring contour detail in coarse to fine", () => {
    expect(CONTOURS_MIN_ZOOM).toBeLessThan(CONTOUR_LABELS_MIN_ZOOM);
    expect(CONTOUR_LABELS_MIN_ZOOM).toBeLessThan(CONTOURS_MINOR_MIN_ZOOM);
    expect(GAUGES_MIN_ZOOM).toBeLessThan(CONTOURS_MIN_ZOOM);
  });
});
