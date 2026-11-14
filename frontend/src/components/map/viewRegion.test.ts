import { NSW_REGION } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { nextViewRegion } from "./viewRegion";

const inNsw = { west: 150.2, south: -33.8, east: 150.4, north: -33.6 };
const elsewhere = { west: 10, south: 10, east: 11, north: 11 };

describe("nextViewRegion", () => {
  // Mutation: return `next` whenever it is not null, and every pan inside the
  // region hands the map a new object and so rebuilds its Terrain group.
  it("keeps the region it had while the map stays over it", () => {
    const held = { ...NSW_REGION };
    expect(nextViewRegion(held, inNsw)).toBe(held);
  });

  // Mutation: return `previous` always, and the map keeps drawing the region
  // it has left.
  it("changes to the region the map moved over, and to none outside every region", () => {
    expect(nextViewRegion(null, inNsw)).toBe(NSW_REGION);
    expect(nextViewRegion(NSW_REGION, elsewhere)).toBeNull();
    expect(nextViewRegion(null, elsewhere)).toBeNull();
  });

  // Mutation: skip `wrapView`, and a map panned round the world (longitudes
  // past 180) is over no region where it shows one.
  it("reads a view panned round the world as where it is", () => {
    const turned = { ...inNsw, west: inNsw.west + 360, east: inNsw.east + 360 };
    expect(nextViewRegion(null, turned)).toBe(NSW_REGION);
  });
});
