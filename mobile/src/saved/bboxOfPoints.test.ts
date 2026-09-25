import { describe, expect, it } from "vitest";

import { bboxOfPoints } from "./bboxOfPoints";

// "Show on map" hands this bbox straight to MapLibre's fitBounds; a zero-extent
// or transposed box makes the camera jump to nowhere.
describe("bboxOfPoints", () => {
  it("returns null for no points", () => {
    expect(bboxOfPoints([])).toBeNull();
  });

  it("spans the extremes as [west, south, east, north]", () => {
    expect(
      bboxOfPoints([
        { lon: 150.3, lat: -33.7 },
        { lon: 150.1, lat: -33.5 },
        { lon: 150.2, lat: -33.9 },
      ]),
    ).toEqual([150.1, -33.9, 150.3, -33.5]);
  });

  it("pads a single-point track so fitBounds has an extent", () => {
    const bbox = bboxOfPoints([{ lon: 150, lat: -33 }]);
    expect(bbox).not.toBeNull();
    const [west, south, east, north] = bbox!;
    expect(east).toBeGreaterThan(west);
    expect(north).toBeGreaterThan(south);
  });
});
