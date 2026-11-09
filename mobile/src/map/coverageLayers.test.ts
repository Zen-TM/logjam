import {
  COVERAGE_HATCH_IMAGE,
  COVERAGE_HATCH_PIXEL_RATIO,
  COVERAGE_HATCH_URIS,
  coverageFilter,
  coverageOpacity,
  NSW_COVERAGE,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import {
  COVERAGE_IMAGES,
  coverageLayerFilter,
  coverageLayerId,
  coverageLayerPaint,
  coverageMinZoom,
} from "./coverageLayers";

describe("coverageLayerPaint", () => {
  // Mutation: build the pattern or the opacity from anything but shared's,
  // and the map hatches where the legend says there is reception, or draws a
  // hatch it doesn't key.
  it("paints with exactly shared's expressions", () => {
    expect(coverageLayerPaint()).toEqual({
      "fill-pattern": COVERAGE_HATCH_IMAGE,
      "fill-opacity": coverageOpacity(),
    });
  });
});

describe("coverageLayerFilter", () => {
  // Mutation: ignore `carrier` and the map draws every carrier's gaps at once.
  it("keeps one carrier's areas", () => {
    expect(coverageLayerFilter("optus")).toEqual(coverageFilter("optus"));
    expect(coverageLayerFilter("optus")).not.toEqual(
      coverageLayerFilter("telstra"),
    );
  });
});

describe("COVERAGE_IMAGES", () => {
  // Mutation: key the hatch by anything but shared's name, and the
  // fill-pattern names an image the style does not have: the gap draws bare.
  // Drop the scale, and the 2x hatch draws twice as coarse as Logjam Web's.
  it("registers the hatch shared's paint names, at its pixel ratio", () => {
    expect(COVERAGE_IMAGES).toEqual(
      Object.fromEntries(
        Object.entries(COVERAGE_HATCH_URIS).map(([name, uri]) => [
          name,
          { source: { uri, scale: COVERAGE_HATCH_PIXEL_RATIO } },
        ]),
      ),
    );
    expect(Object.keys(COVERAGE_IMAGES)).toEqual([COVERAGE_HATCH_IMAGE]);
  });
});

describe("coverageLayerId", () => {
  // Mutation: drop the key, and two saved areas' layers share an id.
  it("is one per source", () => {
    expect(coverageLayerId("b")).not.toBe(coverageLayerId("a"));
  });
});

describe("coverageMinZoom", () => {
  // Mutation: return `layerMinZoom ?? 0` alone, and a CDN source draws
  // coverage below the archive's own first zoom.
  it("never draws below the archive's first zoom", () => {
    expect(coverageMinZoom(undefined)).toBe(NSW_COVERAGE.minzoom);
    expect(coverageMinZoom(NSW_COVERAGE.minzoom - 2)).toBe(
      NSW_COVERAGE.minzoom,
    );
    expect(coverageMinZoom(NSW_COVERAGE.minzoom + 1)).toBe(
      NSW_COVERAGE.minzoom + 1,
    );
  });
});
