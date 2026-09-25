import { describe, expect, it } from "vitest";

import { offlineCoverageMask, type MaskBbox } from "./offlineMask";

/** Is this point inside any rectangle of the mask? */
function masked(mask: GeoJSON.Feature, lon: number, lat: number): boolean {
  const polygons = (mask.geometry as GeoJSON.MultiPolygon).coordinates;
  return polygons.some(([ring]) => {
    const lons = ring.map(([x]) => x);
    const lats = ring.map(([, y]) => y);
    return (
      lon > Math.min(...lons) &&
      lon < Math.max(...lons) &&
      lat > Math.min(...lats) &&
      lat < Math.max(...lats)
    );
  });
}

describe("offlineCoverageMask", () => {
  it("is nothing to draw when no region is downloaded", () => {
    expect(offlineCoverageMask([])).toBeNull();
  });

  it("covers everything outside the one saved region and nothing inside it", () => {
    const mask = offlineCoverageMask([[150, -34, 151, -33]])!;
    expect(masked(mask, 150.5, -33.5)).toBe(false);
    expect(masked(mask, 149, -33.5)).toBe(true); // west of it
    expect(masked(mask, 152, -33.5)).toBe(true); // east of it
    expect(masked(mask, 150.5, -35)).toBe(true); // south of it
    expect(masked(mask, 150.5, -32)).toBe(true); // north of it
    expect(masked(mask, 152.5, -33.5)).toBe(true); // out past the pad
  });

  it("leaves both regions clear when they are far apart", () => {
    const mask = offlineCoverageMask([
      [150, -34, 151, -33],
      [148, -30, 149, -29],
    ])!;
    expect(masked(mask, 150.5, -33.5)).toBe(false);
    expect(masked(mask, 148.5, -29.5)).toBe(false);
    expect(masked(mask, 149.5, -31.5)).toBe(true);
  });

  it("does not re-cover ground where two regions OVERLAP", () => {
    // The case a world-polygon-with-holes gets wrong: earcut turns two
    // overlapping holes into a visible wedge of map inside the saved area.
    const overlapping: MaskBbox[] = [
      [150, -34, 151, -33],
      [150.5, -33.5, 151.5, -32.5],
    ];
    const mask = offlineCoverageMask(overlapping)!;
    expect(masked(mask, 150.75, -33.25)).toBe(false); // the shared corner
    expect(masked(mask, 150.2, -33.8)).toBe(false); // first only
    expect(masked(mask, 151.2, -32.8)).toBe(false); // second only
    expect(masked(mask, 149.5, -33.5)).toBe(true); // outside both
  });

  it("emits no overlapping rectangles", () => {
    const mask = offlineCoverageMask([
      [150, -34, 151, -33],
      [150.5, -33.5, 151.5, -32.5],
    ])!;
    const rects = (mask.geometry as GeoJSON.MultiPolygon).coordinates.map(
      ([ring]) => ({
        west: Math.min(...ring.map(([x]) => x)),
        east: Math.max(...ring.map(([x]) => x)),
        south: Math.min(...ring.map(([, y]) => y)),
        north: Math.max(...ring.map(([, y]) => y)),
      }),
    );
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlaps =
          a.west < b.east && b.west < a.east && a.south < b.north && b.south < a.north;
        expect(overlaps).toBe(false);
      }
    }
  });
});
