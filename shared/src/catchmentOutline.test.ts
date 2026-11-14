import { describe, expect, it } from "vitest";
import {
  catchmentOutline,
  type CatchmentOutline,
  type LonLat,
} from "./catchmentOutline.js";

/** Even–odd ray cast: is the point inside the ring? */
function inside([x, y]: LonLat, ring: LonLat[]): boolean {
  let hit = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      hit = !hit;
  }
  return hit;
}

function polygons(outline: CatchmentOutline): LonLat[][] {
  return outline.type === "Polygon"
    ? [outline.coordinates[0]]
    : outline.coordinates.map((polygon) => polygon[0]);
}

/** A line of `n` points from `a` to `b`. */
function line(a: LonLat, b: LonLat, n = 20): LonLat[] {
  return Array.from(
    { length: n + 1 },
    (_, k): LonLat => [
      a[0] + ((b[0] - a[0]) * k) / n,
      a[1] + ((b[1] - a[1]) * k) / n,
    ],
  );
}

// Two creeks meeting at a right angle, about 2 km each way.
const ell: LonLat[][] = [
  line([150.3, -33.6], [150.3, -33.62]),
  line([150.3, -33.62], [150.322, -33.62]),
];

describe("the land draining to a point", () => {
  it("wraps an L of creeks in one closed, counter-clockwise outline holding every creek", () => {
    const outline = catchmentOutline(ell)!;
    expect(outline.type).toBe("Polygon");
    const [ring] = polygons(outline);
    for (const point of ell.flat()) expect(inside(point, ring)).toBe(true);
    // RFC 7946's outer ring.
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    let area = 0;
    for (let k = 0; k < ring.length - 1; k++)
      area += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
    expect(area).toBeGreaterThan(0);
  });

  // Mutation: drop the closing, and the land between two branches, which
  // drains into one or the other, is left out as a notch.
  it("takes in the land between two branches of a fork", () => {
    const fork: LonLat[][] = [
      line([150.298, -33.6], [150.298, -33.615]),
      line([150.302, -33.6], [150.302, -33.615]),
      line([150.298, -33.615], [150.302, -33.615]),
      line([150.3, -33.615], [150.3, -33.62]),
    ];
    const [ring] = polygons(catchmentOutline(fork)!);
    // Midway between the arms, ~185 m from either.
    expect(inside([150.3, -33.605], ring)).toBe(true);
  });

  // Mutation: keep only the biggest ring, and a catchment whose creeks were
  // split by the trim loses half its land.
  it("keeps two clusters of creeks far apart as two outlines", () => {
    const west = [line([150.3, -33.6], [150.3, -33.61])];
    const east = [line([150.5, -33.6], [150.5, -33.61])];
    const outline = catchmentOutline([...west, ...east])!;
    expect(outline.type).toBe("MultiPolygon");
    const rings = polygons(outline);
    expect(rings).toHaveLength(2);
    for (const point of [...west, ...east].flat())
      expect(rings.some((ring) => inside(point, ring))).toBe(true);
    // Nothing joins them across the 18 km between.
    expect(rings.some((ring) => inside([150.4, -33.605], ring))).toBe(false);
  });

  it("reaches further past the creeks when the smallest were left out", () => {
    const near = polygons(catchmentOutline(ell)!)[0];
    const far = polygons(catchmentOutline(ell, { reachCells: 4 })!)[0];
    const west = (ring: LonLat[]) => Math.min(...ring.map(([x]) => x));
    expect(west(far)).toBeLessThan(west(near));
  });

  it("draws nothing for no creeks", () => {
    expect(catchmentOutline([])).toBeNull();
    expect(catchmentOutline([[]])).toBeNull();
    expect(catchmentOutline([[[Number.NaN, Number.NaN] as LonLat]])).toBeNull();
  });

  it("outlines a single point of creek", () => {
    const outline = catchmentOutline([[[150.3, -33.6]]])!;
    expect(inside([150.3, -33.6], polygons(outline)[0])).toBe(true);
  });
});
