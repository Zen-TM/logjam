import { NSW_REGION, sharpenOfferFor } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { nextViewRegion, startingView } from "./viewRegion";

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

  // Mutation: read the box only as given in `regionTouchesBox` (set `first` and
  // `last` to 0) and the centre unwrapped in `regionInView`, and a map panned
  // round the world (longitudes past 180) is over no region where it shows one.
  it("reads a view panned round the world as where it is", () => {
    const turned = { ...inNsw, west: inNsw.west + 360, east: inNsw.east + 360 };
    expect(nextViewRegion(null, turned)).toBe(NSW_REGION);
  });
});

describe("startingView", () => {
  // Mutation: in viewRegion.ts change `return { box, region: nextViewRegion(null, box) };`
  // to `return { box, region: null };`, and the first render over the default
  // camera reads "Not available here" at a New South Wales user.
  it("offers the New South Wales errand on the first render over the default camera", () => {
    const { region } = startingView(null, undefined);
    expect(region).toBe(NSW_REGION);
    expect(sharpenOfferFor(null, region)).toMatchObject({
      mode: "upload",
      portal: { name: "ELVIS", steps: "elvis" },
    });
  });

  // Mutation: in viewRegion.ts replace `camera ? pointBox(camera.lng, camera.lat)`
  // with `false ? pointBox(camera.lng, camera.lat)`, and a stored camera over
  // Queenstown starts as the home region.
  it("starts where the stored camera is, and over no region there is none", () => {
    const sydney = startingView({ lat: -33.87, lng: 151.21 }, undefined);
    expect(sydney.region).toBe(NSW_REGION);
    const queenstown = startingView({ lat: -45.03, lng: 168.66 }, undefined);
    expect(queenstown.region).toBeNull();
    expect(sharpenOfferFor(null, queenstown.region).mode).toBe("off");
  });
});
