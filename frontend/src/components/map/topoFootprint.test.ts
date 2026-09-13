import { describe, expect, it } from "vitest";
import { boundsIntersect, footprintBounds } from "./topoFootprint";

const square = (west: number, south: number, size: number) => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ],
];

describe("footprintBounds", () => {
  it("boxes a Polygon", () => {
    expect(footprintBounds({ type: "Polygon", coordinates: square(150, -34, 1) })).toEqual({
      west: 150,
      south: -34,
      east: 151,
      north: -33,
    });
  });

  it("boxes every part of a MultiPolygon, not just the first", () => {
    expect(
      footprintBounds({ type: "MultiPolygon", coordinates: [square(150, -34, 1), square(152, -36, 1)] }),
    ).toEqual({ west: 150, south: -36, east: 153, north: -33 });
  });

  it("is null for a footprint with no positions", () => {
    expect(footprintBounds({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("boundsIntersect", () => {
  const view = { west: 150, south: -34, east: 151, north: -33 };

  it("finds overlap, including a shared edge", () => {
    expect(boundsIntersect(view, { west: 150.5, south: -33.5, east: 152, north: -32 })).toBe(true);
    expect(boundsIntersect(view, { west: 151, south: -34, east: 152, north: -33 })).toBe(true);
  });

  it("rejects boxes apart on either axis", () => {
    expect(boundsIntersect(view, { west: 152, south: -34, east: 153, north: -33 })).toBe(false);
    expect(boundsIntersect(view, { west: 150, south: -36, east: 151, north: -35 })).toBe(false);
  });

  it("is false when either box is missing", () => {
    expect(boundsIntersect(view, null)).toBe(false);
  });
});
