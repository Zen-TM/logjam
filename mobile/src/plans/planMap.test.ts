import { describe, expect, it } from "vitest";
import { planBbox } from "./planMap";

const place = (longitude: number, latitude: number) =>
  ({ longitude, latitude }) as never;

describe("what plan mode frames", () => {
  it("is every place and every way's points", () => {
    const box = planBbox({
      places: [place(150.3, -33.5)],
      routes: [{ points: [[150.4, -33.6]] } as never],
    })!;
    [150.3, -33.6, 150.4, -33.5].forEach((edge, i) =>
      expect(box[i]).toBeCloseTo(edge),
    );
  });

  // Mutation: drop the widening. One place, or places metres apart, would
  // frame a street's width instead of the ~1 km a place's Show on map does.
  it("frames ground around a single place", () => {
    const [west, south, east, north] = planBbox({
      places: [place(150.3, -33.5)],
      routes: [],
    })!;
    expect(east - west).toBeCloseTo(0.01);
    expect(north - south).toBeCloseTo(0.01);
  });

  it("is nothing for a plan with nothing on the map", () => {
    expect(planBbox({ places: [], routes: [] })).toBeNull();
  });
});
