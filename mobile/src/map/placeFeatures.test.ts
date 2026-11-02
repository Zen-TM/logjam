import { describe, expect, it } from "vitest";

import { toPlaceFeatureCollection } from "./placeFeatures";

const places = ["a", "b"].map((id) => ({
  id,
  name: id,
  latitude: -33.7,
  longitude: 150.3,
}));
const visitedOf = (fc: ReturnType<typeof toPlaceFeatureCollection>) =>
  fc.features.map((f) => f.properties.visited);

describe("toPlaceFeatureCollection visited stamp", () => {
  // Mutation: stamp every feature true (or none), and the visited halo
  // draws on the wrong places.
  it("is true only for ids in the set", () => {
    expect(
      visitedOf(toPlaceFeatureCollection(places, {}, new Set(["a"]))),
    ).toEqual([true, false]);
  });

  it("is false for all when no set is given", () => {
    expect(visitedOf(toPlaceFeatureCollection(places))).toEqual([false, false]);
  });
});
